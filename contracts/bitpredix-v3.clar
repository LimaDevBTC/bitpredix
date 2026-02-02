;; Bitpredix v3 - Mercado de predicacao BTC (rounds 1 min)
;; Versao para deploy como bitpredix-v3: SELF = .bitpredix-v3
;; Usar se bitpredix-v2 ja existir (deploy anterior)

;; ---- Constantes ----
(define-constant ORACLE 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)
(define-constant SELF 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK.bitpredix-v3)
(define-constant FEE_BPS u300)
(define-constant MIN_BET u1000000)
;; Testnet: todos os fees vao para o deployer (em mainnet, usar enderecos SP separados)
(define-constant FEE_RECIPIENT_DEV 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)
(define-constant FEE_RECIPIENT_CONSULTANT 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)
(define-constant FEE_RECIPIENT_PO 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)

;; ---- Maps ----
(define-map rounds
  { round-id: uint }
  {
    start-at: uint,
    ends-at: uint,
    trading-closes-at: uint,
    price-at-start: uint,
    price-at-end: uint,
    status: (string-ascii 10),
    outcome: (string-ascii 4),
    pool-up: uint,
    pool-down: uint,
    volume-traded: uint,
    total-shares-up: uint,
    total-shares-down: uint
  })

(define-map positions
  { round-id: uint, user: principal, side: (string-ascii 4) }
  { shares: uint, cost: uint, settled: bool })

;; ---- create-round (so ORACLE; idempotente) ----
(define-public (create-round (round-id uint) (price-at-start uint))
  (let ((existing (map-get? rounds { round-id: round-id })))
    (if (is-some existing)
      (ok true)
      (begin
        (asserts! (is-eq tx-sender ORACLE) (err u401))
        (let ((ends-at (+ round-id u60))
              (trading-closes-at (- (+ round-id u60) u12)))
          (map-set rounds { round-id: round-id }
            {
              start-at: round-id,
              ends-at: ends-at,
              trading-closes-at: trading-closes-at,
              price-at-start: price-at-start,
              price-at-end: u0,
              status: "TRADING",
              outcome: "NONE",
              pool-up: u0,
              pool-down: u0,
              volume-traded: u0,
              total-shares-up: u0,
              total-shares-down: u0
            }))
        (ok true)))))

;; ---- place-bet ----
(define-public (place-bet (round-id uint) (side (string-ascii 4)) (amount-usd uint))
  (let ((r (unwrap! (map-get? rounds { round-id: round-id }) (err u1001))))
    (asserts! (is-eq (get status r) "TRADING") (err u1002))
    ;; Validacao de timing removida - o daemon resolve o round no momento certo
    ;; e o status TRADING garante que ainda esta aberto
    (asserts! (>= amount-usd MIN_BET) (err u1002))
    (asserts! (or (is-eq side "UP") (is-eq side "DOWN")) (err u1002))
    (try! (contract-call? .test-usdcx transfer-from tx-sender SELF amount-usd none))
    (let ((shares amount-usd))
      (if (is-eq side "UP")
        (map-set rounds { round-id: round-id }
          (merge r {
            pool-up: (+ (get pool-up r) amount-usd),
            volume-traded: (+ (get volume-traded r) amount-usd),
            total-shares-up: (+ (get total-shares-up r) shares)
          }))
        (map-set rounds { round-id: round-id }
          (merge r {
            pool-down: (+ (get pool-down r) amount-usd),
            volume-traded: (+ (get volume-traded r) amount-usd),
            total-shares-down: (+ (get total-shares-down r) shares)
          })))
      (let ((old (default-to { shares: u0, cost: u0, settled: false }
                   (map-get? positions { round-id: round-id, user: tx-sender, side: side }))))
        (map-set positions { round-id: round-id, user: tx-sender, side: side }
          {
            shares: (+ (get shares old) shares),
            cost: (+ (get cost old) amount-usd),
            settled: (get settled old)
          })))
    (ok true)))

;; ---- resolve-round (recebe price-at-end; idempotente; robusto com pool vazio) ----
(define-public (resolve-round (round-id uint) (price-at-end uint))
  (begin
    (asserts! (is-eq tx-sender ORACLE) (err u401))
    (let ((r (unwrap! (map-get? rounds { round-id: round-id }) (err u1001))))
      (if (is-eq (get status r) "RESOLVED")
        (ok true)
        (let ((pool-sum (+ (get pool-up r) (get pool-down r)))
              (price-at-start (get price-at-start r))
              (outcome (if (> price-at-end price-at-start) "UP" "DOWN")))
          (begin
            (if (> pool-sum u0)
              (let ((fee-total (/ (* pool-sum FEE_BPS) u10000))
                    (fee-dev (/ (* fee-total u10) u100))
                    (fee-consultant (/ (* fee-total u10) u100))
                    (fee-po (- fee-total (+ fee-dev fee-consultant))))
                (begin
                  (if (> fee-dev u0)
                    (match (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_DEV fee-dev none)
                      ok-val true
                      err-val true)
                    true)
                  (if (> fee-consultant u0)
                    (match (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_CONSULTANT fee-consultant none)
                      ok-val true
                      err-val true)
                    true)
                  (if (> fee-po u0)
                    (match (contract-call? .test-usdcx transfer-from SELF FEE_RECIPIENT_PO fee-po none)
                      ok-val true
                      err-val true)
                    true)))
              true)
            (map-set rounds { round-id: round-id }
              (merge r {
                status: "RESOLVED",
                price-at-end: price-at-end,
                outcome: outcome
              }))
            (ok true)))))))

;; ---- claim-winnings ----
(define-public (claim-winnings (round-id uint))
  (let ((r (unwrap! (map-get? rounds { round-id: round-id }) (err u1001)))
        (outcome (get outcome r)))
    (asserts! (is-eq (get status r) "RESOLVED") (err u1002))
    (let ((pos (unwrap! (map-get? positions { round-id: round-id, user: tx-sender, side: outcome }) (err u1004))))
      (asserts! (not (get settled pos)) (err u1004))
      (let ((total-winning (if (is-eq outcome "UP") (get total-shares-up r) (get total-shares-down r)))
            (pool-sum (+ (get pool-up r) (get pool-down r)))
            (fee-total (/ (* pool-sum FEE_BPS) u10000))
            (net-pool (- pool-sum fee-total)))
        (asserts! (> total-winning u0) (err u1004))
        (let ((payout (/ (* (get shares pos) net-pool) total-winning)))
          (try! (contract-call? .test-usdcx transfer-from SELF tx-sender payout none))
          (map-set positions { round-id: round-id, user: tx-sender, side: outcome }
            (merge pos { settled: true }))
          (ok true))))))
