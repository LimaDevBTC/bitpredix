;; ============================================================================
;; PREDIX v1 - Prediction Market (Beta/Testnet)
;; ============================================================================
;; Baseado em bitpredix-v6 com as seguintes mudancas:
;; - Cutoff 5s (TRADING_WINDOW u55) com validacao on-chain em place-bet
;; - resolve-round: resolucao automatica de rounds (deployer ou apostador)
;; - claim-on-behalf: auto-claim via backend (apenas deployer)
;; - round-bettors: tracking de apostadores por round para auto-claim
;; ============================================================================

;; ----------------------------------------------------------------------------
;; CONSTANTES
;; ----------------------------------------------------------------------------

(define-constant CONTRACT_OWNER tx-sender)
(define-constant SELF 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.predixv1)
(define-constant DEPLOYER 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)

;; Erros
(define-constant ERR_UNAUTHORIZED (err u1000))
(define-constant ERR_ROUND_NOT_ENDED (err u1001))
(define-constant ERR_NO_BET (err u1002))
(define-constant ERR_ALREADY_CLAIMED (err u1003))
(define-constant ERR_INVALID_SIDE (err u1004))
(define-constant ERR_INVALID_AMOUNT (err u1005))
(define-constant ERR_TRADING_CLOSED (err u1006))
(define-constant ERR_TRANSFER_FAILED (err u1007))
(define-constant ERR_INVALID_PRICES (err u1009))
(define-constant ERR_ALREADY_RESOLVED (err u1012))

;; Configuracao de tempo (em segundos)
(define-constant ROUND_DURATION u60)        ;; 60 segundos por round
(define-constant TRADING_WINDOW u55)        ;; Cutoff 5s -- trading fecha 5s antes do fim do round

;; Configuracao financeira
(define-constant MIN_BET u1000000)          ;; 1 USDCx minimo (6 decimais)
(define-constant FEE_BPS u300)              ;; 3% fee (300 basis points)
(define-constant FEE_RECIPIENT 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)

;; ----------------------------------------------------------------------------
;; DATA MAPS
;; ----------------------------------------------------------------------------

;; Informacoes do round (criado quando primeira aposta acontece)
(define-map rounds
  { round-id: uint }
  {
    total-up: uint,         ;; Total apostado em UP
    total-down: uint,       ;; Total apostado em DOWN
    price-start: uint,      ;; Preco de abertura (centavos, 2 decimais)
    price-end: uint,        ;; Preco de fechamento (centavos, 2 decimais)
    resolved: bool          ;; Se ja foi resolvido
  }
)

;; Apostas individuais - side faz parte da key (permite UP e DOWN por usuario)
(define-map bets
  { round-id: uint, user: principal, side: (string-ascii 4) }
  { amount: uint, claimed: bool }
)

;; Lista de rounds pendentes por usuario (para o botao CLAIM)
;; Maximo de 50 rounds pendentes por usuario
(define-map user-pending-rounds
  { user: principal }
  { round-ids: (list 50 uint) }
)

;; Lista de apostadores por round (para backend auto-claim)
(define-map round-bettors
  { round-id: uint }
  { bettors: (list 200 principal) }
)

;; ----------------------------------------------------------------------------
;; VARIAVEIS DE ESTADO
;; ----------------------------------------------------------------------------

;; Variavel auxiliar para filtrar rounds (usada em remove-user-pending-round)
(define-data-var filter-target-round uint u0)

;; ----------------------------------------------------------------------------
;; FUNCOES PRIVADAS
;; ----------------------------------------------------------------------------

;; Helper para filter - verifica se o round NAO e o target
(define-private (is-not-target-round (id uint))
  (not (is-eq id (var-get filter-target-round)))
)

;; Adiciona um round a lista de pendentes do usuario
(define-private (add-user-pending-round (user principal) (round-id uint))
  (let (
    (current-data (default-to { round-ids: (list ) } (map-get? user-pending-rounds { user: user })))
    (current-list (get round-ids current-data))
  )
    ;; Verifica se ja nao esta na lista
    (if (is-some (index-of? current-list round-id))
      (ok true)
      ;; Adiciona a lista (maximo 50)
      (match (as-max-len? (append current-list round-id) u50)
        new-list (begin
          (map-set user-pending-rounds { user: user } { round-ids: new-list })
          (ok true)
        )
        ;; Lista cheia - usuario precisa fazer claim primeiro
        (err u1010)
      )
    )
  )
)

;; Remove um round da lista de pendentes do usuario
(define-private (remove-user-pending-round (user principal) (round-id uint))
  (let (
    (current-data (default-to { round-ids: (list ) } (map-get? user-pending-rounds { user: user })))
    (current-list (get round-ids current-data))
  )
    ;; Seta o target antes de filtrar
    (var-set filter-target-round round-id)
    (let ((filtered-list (filter is-not-target-round current-list)))
      (map-set user-pending-rounds { user: user } { round-ids: filtered-list })
      true
    )
  )
)

;; Adiciona apostador a lista do round (para auto-claim pelo backend)
;; Retorna bool, nunca falha -- se lista cheia, retorna true silenciosamente
(define-private (add-bettor-to-round (round-id uint) (bettor principal))
  (let (
    (current-data (default-to { bettors: (list ) } (map-get? round-bettors { round-id: round-id })))
    (current-list (get bettors current-data))
  )
    (if (is-some (index-of? current-list bettor))
      true
      (match (as-max-len? (append current-list bettor) u200)
        new-list (begin
          (map-set round-bettors { round-id: round-id } { bettors: new-list })
          true)
        true
      )
    )
  )
)

;; ----------------------------------------------------------------------------
;; FUNCOES PUBLICAS
;; ----------------------------------------------------------------------------

;; Apostar em um round
;; @param round-id: ID do round (timestamp do inicio / 60)
;; @param side: "UP" ou "DOWN"
;; @param amount: quantidade em USDCx (6 decimais)
;; Permite multiplas apostas: mesmo lado acumula, lados opostos coexistem
(define-public (place-bet (round-id uint) (side (string-ascii 4)) (amount uint))
  (let (
    (round-start-time (* round-id ROUND_DURATION))
    (trading-close-time (+ round-start-time TRADING_WINDOW))
    (current-time (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1))))
    (current-round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
    (existing-bet (map-get? bets { round-id: round-id, user: tx-sender, side: side }))
    (current-amount (default-to u0 (get amount existing-bet)))
  )
    ;; Validacoes
    (asserts! (or (is-eq side "UP") (is-eq side "DOWN")) ERR_INVALID_SIDE)
    (asserts! (>= amount MIN_BET) ERR_INVALID_AMOUNT)
    ;; Validacao on-chain: impede apostas em rounds ja encerrados
    (asserts! (< current-time trading-close-time) ERR_TRADING_CLOSED)
    ;; Impede apostas em rounds ja resolvidos (fecha janela residual de atraso de bloco)
    (asserts! (not (get resolved current-round-data)) ERR_TRADING_CLOSED)

    ;; Transfere tokens do usuario para o contrato (requer approve previo)
    (try! (contract-call? .test-usdcx transfer-from tx-sender SELF amount none))

    ;; Atualiza totais do round
    (map-set rounds { round-id: round-id }
      {
        total-up: (if (is-eq side "UP")
          (+ (get total-up current-round-data) amount)
          (get total-up current-round-data)),
        total-down: (if (is-eq side "DOWN")
          (+ (get total-down current-round-data) amount)
          (get total-down current-round-data)),
        price-start: (get price-start current-round-data),
        price-end: (get price-end current-round-data),
        resolved: (get resolved current-round-data)
      }
    )

    ;; Registra/acumula aposta do usuario (side agora e parte da key)
    (map-set bets { round-id: round-id, user: tx-sender, side: side }
      { amount: (+ current-amount amount), claimed: false }
    )

    ;; Adiciona round a lista de pendentes do usuario
    (try! (add-user-pending-round tx-sender round-id))

    ;; Adiciona bettor a lista do round (para auto-claim)
    (add-bettor-to-round round-id tx-sender)

    (ok {
      round-id: round-id,
      side: side,
      amount: amount
    })
  )
)

;; Claim de um round por side (fallback manual -- usuario paga gas)
;; Frontend busca precos do Pyth Benchmarks API e passa aqui
;; @param round-id: ID do round
;; @param side: "UP" ou "DOWN" - qual aposta claimar
;; @param price-start: Preco de abertura em centavos (ex: 9750000 = $97,500.00)
;; @param price-end: Preco de fechamento em centavos
(define-public (claim-round-side (round-id uint) (side (string-ascii 4)) (price-start uint) (price-end uint))
  (let (
    (user tx-sender)
    (round-end-time (* (+ round-id u1) ROUND_DURATION))
    (round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
    (bet-data (unwrap! (map-get? bets { round-id: round-id, user: tx-sender, side: side }) ERR_NO_BET))
  )
    ;; Validacoes
    (asserts! (or (is-eq side "UP") (is-eq side "DOWN")) ERR_INVALID_SIDE)
    (asserts! (not (get claimed bet-data)) ERR_ALREADY_CLAIMED)
    (asserts! (> price-start u0) ERR_INVALID_PRICES)
    (asserts! (> price-end u0) ERR_INVALID_PRICES)

    ;; Resolve o round se ainda nao foi resolvido
    ;; Primeiro claim define os precos (confiamos no frontend para beta)
    (if (not (get resolved round-data))
      (map-set rounds { round-id: round-id }
        (merge round-data {
          price-start: price-start,
          price-end: price-end,
          resolved: true
        })
      )
      true
    )

    ;; Busca dados atualizados do round (com precos resolvidos)
    (let (
      (final-round (unwrap-panic (map-get? rounds { round-id: round-id })))
      (final-price-start (get price-start final-round))
      (final-price-end (get price-end final-round))
      (outcome (if (> final-price-end final-price-start) "UP" "DOWN"))
      (user-won (is-eq side outcome))
      (total-pool (+ (get total-up final-round) (get total-down final-round)))
      (winning-pool (if (is-eq outcome "UP")
        (get total-up final-round)
        (get total-down final-round)))
      (user-amount (get amount bet-data))
    )
      ;; Marca aposta como claimed
      (map-set bets { round-id: round-id, user: user, side: side }
        (merge bet-data { claimed: true })
      )

      ;; Remove da lista de pendentes SOMENTE se ambos os lados ja foram claimed
      ;; (ou se o usuario so apostou em um lado)
      (let (
        (other-side (if (is-eq side "UP") "DOWN" "UP"))
        (other-bet (map-get? bets { round-id: round-id, user: user, side: other-side }))
        (other-claimed (match other-bet ob (get claimed ob) true))
      )
        (if other-claimed
          (begin (remove-user-pending-round user round-id) true)
          true
        )
      )

      ;; Calcula e paga se ganhou
      ;; Usa transfer-from: test-usdcx permite se from == contract-caller (SELF)
      (if user-won
        (if (> winning-pool u0)
          (let (
            ;; Payout proporcional: (user_amount / winning_pool) * total_pool
            (gross-payout (/ (* user-amount total-pool) winning-pool))
            (fee (/ (* gross-payout FEE_BPS) u10000))
            (net-payout (- gross-payout fee))
          )
            ;; Transfere premio para o usuario (SELF -> user)
            (try! (contract-call? .test-usdcx transfer-from SELF user net-payout none))
            ;; Transfere fee (SELF -> FEE_RECIPIENT)
            (if (> fee u0)
              (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT fee none))
              true
            )
            (ok {
              won: true,
              payout: net-payout,
              outcome: outcome,
              price-start: final-price-start,
              price-end: final-price-end
            })
          )
          ;; Edge case: winning pool = 0 (ninguem apostou no lado vencedor)
          ;; Usuario recebe de volta o que apostou
          (begin
            (try! (contract-call? .test-usdcx transfer-from SELF user user-amount none))
            (ok {
              won: true,
              payout: user-amount,
              outcome: outcome,
              price-start: final-price-start,
              price-end: final-price-end
            })
          )
        )
        ;; Perdeu - nao recebe nada
        (ok {
          won: false,
          payout: u0,
          outcome: outcome,
          price-start: final-price-start,
          price-end: final-price-end
        })
      )
    )
  )
)

;; Resolve um round (seta precos e marca como resolvido)
;; Apenas deployer ou apostador do round pode chamar
;; @param round-id: ID do round
;; @param price-start: Preco de abertura em centavos
;; @param price-end: Preco de fechamento em centavos
(define-public (resolve-round (round-id uint) (price-start uint) (price-end uint))
  (let (
    (round-end-time (* (+ round-id u1) ROUND_DURATION))
    (current-time (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1))))
    (round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
  )
    ;; Apenas deployer ou apostador pode resolver
    (asserts! (or
      (is-eq tx-sender DEPLOYER)
      (is-some (map-get? bets { round-id: round-id, user: tx-sender, side: "UP" }))
      (is-some (map-get? bets { round-id: round-id, user: tx-sender, side: "DOWN" }))
    ) ERR_UNAUTHORIZED)
    ;; Round deve ter terminado
    (asserts! (> current-time round-end-time) ERR_ROUND_NOT_ENDED)
    ;; Precos validos
    (asserts! (> price-start u0) ERR_INVALID_PRICES)
    (asserts! (> price-end u0) ERR_INVALID_PRICES)
    ;; Nao pode resolver duas vezes
    (asserts! (not (get resolved round-data)) ERR_ALREADY_RESOLVED)

    ;; Seta precos e marca como resolvido
    (map-set rounds { round-id: round-id }
      (merge round-data { price-start: price-start, price-end: price-end, resolved: true }))

    (ok { round-id: round-id,
          outcome: (if (> price-end price-start) "UP" "DOWN"),
          price-start: price-start,
          price-end: price-end })
  )
)

;; Claim em nome de um usuario (chamado pelo backend/deployer)
;; Apenas DEPLOYER pode chamar. Payout vai para o usuario, deployer paga gas.
(define-public (claim-on-behalf (user principal) (round-id uint) (side (string-ascii 4)) (price-start uint) (price-end uint))
  (let (
    (round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
    (bet-data (unwrap! (map-get? bets { round-id: round-id, user: user, side: side }) ERR_NO_BET))
  )
    ;; Apenas deployer pode chamar
    (asserts! (is-eq tx-sender DEPLOYER) ERR_UNAUTHORIZED)
    ;; Validacoes
    (asserts! (or (is-eq side "UP") (is-eq side "DOWN")) ERR_INVALID_SIDE)
    (asserts! (not (get claimed bet-data)) ERR_ALREADY_CLAIMED)
    (asserts! (> price-start u0) ERR_INVALID_PRICES)
    (asserts! (> price-end u0) ERR_INVALID_PRICES)

    ;; Resolve o round se ainda nao foi resolvido (safety net)
    (if (not (get resolved round-data))
      (map-set rounds { round-id: round-id }
        (merge round-data { price-start: price-start, price-end: price-end, resolved: true }))
      true
    )

    ;; Busca dados atualizados do round
    (let (
      (final-round (unwrap-panic (map-get? rounds { round-id: round-id })))
      (final-price-start (get price-start final-round))
      (final-price-end (get price-end final-round))
      (outcome (if (> final-price-end final-price-start) "UP" "DOWN"))
      (user-won (is-eq side outcome))
      (total-pool (+ (get total-up final-round) (get total-down final-round)))
      (winning-pool (if (is-eq outcome "UP")
        (get total-up final-round)
        (get total-down final-round)))
      (user-amount (get amount bet-data))
    )
      ;; Marca aposta como claimed
      (map-set bets { round-id: round-id, user: user, side: side }
        (merge bet-data { claimed: true }))

      ;; Remove da lista de pendentes se ambos os lados ja foram claimed
      (let (
        (other-side (if (is-eq side "UP") "DOWN" "UP"))
        (other-bet (map-get? bets { round-id: round-id, user: user, side: other-side }))
        (other-claimed (match other-bet ob (get claimed ob) true))
      )
        (if other-claimed
          (begin (remove-user-pending-round user round-id) true)
          true
        )
      )

      ;; Calcula e paga se ganhou
      (if user-won
        (if (> winning-pool u0)
          (let (
            (gross-payout (/ (* user-amount total-pool) winning-pool))
            (fee (/ (* gross-payout FEE_BPS) u10000))
            (net-payout (- gross-payout fee))
          )
            (try! (contract-call? .test-usdcx transfer-from SELF user net-payout none))
            (if (> fee u0)
              (try! (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT fee none))
              true
            )
            (ok { won: true, payout: net-payout, outcome: outcome,
                  price-start: final-price-start, price-end: final-price-end })
          )
          (begin
            (try! (contract-call? .test-usdcx transfer-from SELF user user-amount none))
            (ok { won: true, payout: user-amount, outcome: outcome,
                  price-start: final-price-start, price-end: final-price-end })
          )
        )
        (ok { won: false, payout: u0, outcome: outcome,
              price-start: final-price-start, price-end: final-price-end })
      )
    )
  )
)

;; ----------------------------------------------------------------------------
;; FUNCOES READ-ONLY
;; ----------------------------------------------------------------------------

;; Retorna o round-id atual baseado no timestamp
;; Cada round dura 60 segundos, round-id = timestamp / 60
(define-read-only (get-current-round-id)
  (/ (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1))) u60)
)

;; Retorna dados de um round
(define-read-only (get-round (round-id uint))
  (map-get? rounds { round-id: round-id })
)

;; Retorna aposta de um usuario em um round para um side especifico
(define-read-only (get-bet (round-id uint) (user principal) (side (string-ascii 4)))
  (map-get? bets { round-id: round-id, user: user, side: side })
)

;; Retorna ambos os lados de aposta de um usuario em um round
(define-read-only (get-user-bets (round-id uint) (user principal))
  {
    up: (map-get? bets { round-id: round-id, user: user, side: "UP" }),
    down: (map-get? bets { round-id: round-id, user: user, side: "DOWN" })
  }
)

;; Retorna lista de rounds pendentes de um usuario
(define-read-only (get-user-pending-rounds (user principal))
  (default-to
    { round-ids: (list ) }
    (map-get? user-pending-rounds { user: user })
  )
)

;; Retorna quantidade de rounds pendentes
(define-read-only (get-pending-count (user principal))
  (len (get round-ids (get-user-pending-rounds user)))
)

;; Verifica se um round ja terminou
(define-read-only (is-round-ended (round-id uint))
  (let ((round-end-time (* (+ round-id u1) ROUND_DURATION)))
    (> (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1))) round-end-time)
  )
)

;; Verifica se trading ainda esta aberto para um round
(define-read-only (is-trading-open (round-id uint))
  (let (
    (round-start-time (* round-id ROUND_DURATION))
    (trading-close-time (+ round-start-time TRADING_WINDOW))
    (current-time (unwrap-panic (get-stacks-block-info? time (- stacks-block-height u1))))
  )
    (and
      (>= current-time round-start-time)
      (< current-time trading-close-time)
    )
  )
)

;; Retorna lista de apostadores de um round
(define-read-only (get-round-bettors (round-id uint))
  (default-to { bettors: (list ) }
    (map-get? round-bettors { round-id: round-id }))
)
