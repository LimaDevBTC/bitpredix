;; Oracle - cache round-id -> price (fonte: Bitstamp testnet, Pyth mainnet)
;; Ref: docs/PLANO_TESTNET_STACKS.md 3.2b, 3.2c

;; Deployer = ORACLE em testnet (carteira dev)
(define-constant ORACLE 'ST1QPMHMXY9GW7YF5MA9PDD84G3BGV0SSJ74XS9EK)

(define-map prices
  { round-id: uint }
  uint)

;; CORRIGIDO: idempotente - aceita duplicate com mesmo preco (permite retries)
(define-public (set-price (round-id uint) (price uint))
  (let ((existing (map-get? prices { round-id: round-id })))
    (asserts! (is-eq tx-sender ORACLE) (err u2))
    (match existing
      old-price (if (is-eq old-price price)
                  (ok true)  ;; idempotente: mesmo preco, ok
                  (err u1))  ;; preco diferente, rejeita
      (begin
        (map-set prices { round-id: round-id } price)
        (ok true)))))

(define-read-only (get-price (round-id uint))
  (map-get? prices { round-id: round-id }))
