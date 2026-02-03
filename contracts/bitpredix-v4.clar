;; ============================================================================
;; BITPREDIX v4 - Prediction Market (Beta/Testnet)
;; ============================================================================
;; Arquitetura simplificada:
;; - Rounds sao virtuais (derivados do timestamp, nao precisam ser criados)
;; - Precos vem do Pyth Oracle via frontend no momento do claim
;; - Zero dependencia de daemon/oracle server
;; - Claim resolve o round e paga o usuario em uma unica transacao
;; ============================================================================

;; ----------------------------------------------------------------------------
;; CONSTANTES
;; ----------------------------------------------------------------------------

(define-constant CONTRACT_OWNER tx-sender)
(define-constant SELF 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v4)

;; Erros
(define-constant ERR_UNAUTHORIZED (err u1000))
(define-constant ERR_ROUND_NOT_ENDED (err u1001))
(define-constant ERR_NO_BET (err u1002))
(define-constant ERR_ALREADY_CLAIMED (err u1003))
(define-constant ERR_INVALID_SIDE (err u1004))
(define-constant ERR_INVALID_AMOUNT (err u1005))
(define-constant ERR_TRADING_CLOSED (err u1006))
(define-constant ERR_TRANSFER_FAILED (err u1007))
(define-constant ERR_ALREADY_BET (err u1008))
(define-constant ERR_INVALID_PRICES (err u1009))

;; Configuracao de tempo (em segundos)
(define-constant ROUND_DURATION u60)        ;; 60 segundos por round
(define-constant TRADING_WINDOW u48)        ;; Trading aberto por 48s (fecha 12s antes do fim)

;; Configuracao financeira
(define-constant MIN_BET u1000000)          ;; 1 USDCx minimo (6 decimais)
(define-constant FEE_BPS u300)              ;; 3% fee (300 basis points)
(define-constant FEE_RECIPIENT 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)

;; Token USDCx (testnet)
(define-constant TOKEN_CONTRACT 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.test-usdcx)

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

;; Apostas individuais
(define-map bets
  { round-id: uint, user: principal }
  {
    side: (string-ascii 4),  ;; "UP" ou "DOWN"
    amount: uint,            ;; Quantidade apostada (6 decimais)
    claimed: bool            ;; Se ja fez claim
  }
)

;; Lista de rounds pendentes por usuario (para o botao CLAIM)
;; Maximo de 50 rounds pendentes por usuario
(define-map user-pending-rounds
  { user: principal }
  { round-ids: (list 50 uint) }
)

;; ----------------------------------------------------------------------------
;; FUNCOES PUBLICAS
;; ----------------------------------------------------------------------------

;; Apostar em um round
;; @param round-id: ID do round (timestamp do inicio / 60)
;; @param side: "UP" ou "DOWN"
;; @param amount: quantidade em USDCx (6 decimais)
(define-public (place-bet (round-id uint) (side (string-ascii 4)) (amount uint))
  (let (
    (round-start-time (* round-id ROUND_DURATION))
    (trading-close-time (+ round-start-time TRADING_WINDOW))
    (current-round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
    (existing-bet (map-get? bets { round-id: round-id, user: tx-sender }))
  )
    ;; Validacoes
    (asserts! (or (is-eq side "UP") (is-eq side "DOWN")) ERR_INVALID_SIDE)
    (asserts! (>= amount MIN_BET) ERR_INVALID_AMOUNT)
    (asserts! (is-none existing-bet) ERR_ALREADY_BET)

    ;; Transfere tokens do usuario para o contrato (requer approve previo)
    (try! (contract-call? TOKEN_CONTRACT transfer-from tx-sender SELF amount none))

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

    ;; Registra aposta do usuario
    (map-set bets { round-id: round-id, user: tx-sender }
      { side: side, amount: amount, claimed: false }
    )

    ;; Adiciona round a lista de pendentes do usuario
    (try! (add-user-pending-round tx-sender round-id))

    (ok {
      round-id: round-id,
      side: side,
      amount: amount
    })
  )
)

;; Claim de um round especifico
;; Frontend busca precos do Pyth Benchmarks API e passa aqui
;; @param round-id: ID do round
;; @param price-start: Preco de abertura em centavos (ex: 9750000 = $97,500.00)
;; @param price-end: Preco de fechamento em centavos
(define-public (claim-round (round-id uint) (price-start uint) (price-end uint))
  (let (
    (user tx-sender)  ;; Captura o usuario no inicio
    (round-end-time (* (+ round-id u1) ROUND_DURATION))
    (round-data (default-to
      { total-up: u0, total-down: u0, price-start: u0, price-end: u0, resolved: false }
      (map-get? rounds { round-id: round-id })))
    (bet-data (unwrap! (map-get? bets { round-id: round-id, user: tx-sender }) ERR_NO_BET))
  )
    ;; Validacoes
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
      (user-won (is-eq (get side bet-data) outcome))
      (total-pool (+ (get total-up final-round) (get total-down final-round)))
      (winning-pool (if (is-eq outcome "UP")
        (get total-up final-round)
        (get total-down final-round)))
      (user-amount (get amount bet-data))
    )
      ;; Marca aposta como claimed
      (map-set bets { round-id: round-id, user: user }
        (merge bet-data { claimed: true })
      )

      ;; Remove da lista de pendentes
      (remove-user-pending-round user round-id)

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
            (try! (contract-call? TOKEN_CONTRACT transfer-from SELF user net-payout none))
            ;; Transfere fee (SELF -> FEE_RECIPIENT)
            (if (> fee u0)
              (try! (contract-call? TOKEN_CONTRACT transfer-from SELF FEE_RECIPIENT fee none))
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
            (try! (contract-call? TOKEN_CONTRACT transfer-from SELF user user-amount none))
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

;; Retorna aposta de um usuario em um round
(define-read-only (get-bet (round-id uint) (user principal))
  (map-get? bets { round-id: round-id, user: user })
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
