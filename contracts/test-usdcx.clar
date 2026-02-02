;; test-usdcx - Token SIP-010 para testnet (1 000 USD por user, uma vez)
;; Ref: docs/PLANO_TESTNET_STACKS.md 3.2, docs/DUVIDAS_ABERTAS, docs/PRE_DEPLOY_TESTNET 4
;;
;; - impl-trait SIP-010 (testnet)
;; - mint(): 1 000 USD (1_000_000_000, 6 decimais) uma vez por principal
;; - approve / transfer-from; regra: se from = contract-caller, permite sem allowance (escrow bitpredix)

;; Local/simnet: .sip-010-trait (contracts/sip-010-trait.clar).
;; Para testnet: fazemos deploy do nosso sip-010-trait primeiro; assim .sip-010-trait resolve.
(impl-trait .sip-010-trait.sip-010-trait)

(define-fungible-token test-usdcx)

;; 1 000 USD em 6 decimais
(define-constant MINT_AMOUNT u1000000000)

(define-map allowances
  { owner: principal, spender: principal }
  uint)

(define-map minted
  { who: principal }
  uint)

;; ---- SIP-010: transfer (amount, sender, recipient, memo) ----
(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) (err u4))
    (asserts! (> amount u0) (err u3))
    (asserts! (not (is-eq sender recipient)) (err u2))
    (asserts! (>= (ft-get-balance test-usdcx sender) amount) (err u1))
    (try! (ft-transfer? test-usdcx amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

;; ---- approve(spender, amount) -> allowance(tx-sender, spender) = amount ----
(define-public (approve (spender principal) (amount uint))
  (begin
    (map-set allowances { owner: tx-sender, spender: spender } amount)
    (ok true)))

;; ---- transfer-from(from, to, amount, memo) ----
;; Regra: se from = contract-caller (bitpredix a enviar do escrow), permite sem allowance.
;; Caso contrario: allowance(from, contract-caller) >= amount.
(define-public (transfer-from (from principal) (to principal) (amount uint) (memo (optional (buff 34))))
  (let
    (
      (spender contract-caller)
      (allow (default-to u0 (map-get? allowances { owner: from, spender: spender })))
    )
    (asserts! (> amount u0) (err u3))
    (if (is-eq from spender)
      ;; from = contract-caller: envio do proprio saldo (escrow), sem allowance
      (begin
        (try! (ft-transfer? test-usdcx amount from to))
        (match memo to-print (print to-print) 0x)
        (ok true))
      ;; senao: exige allowance(from, contract-caller) >= amount
      (begin
        (asserts! (>= allow amount) (err u5))
        (map-set allowances { owner: from, spender: spender } (- allow amount))
        (try! (ft-transfer? test-usdcx amount from to))
        (match memo to-print (print to-print) 0x)
        (ok true)))))

;; ---- get-name ----
(define-read-only (get-name)
  (ok "Test USDCx"))

;; ---- get-symbol ----
(define-read-only (get-symbol)
  (ok "USDCx"))

;; ---- get-decimals ----
(define-read-only (get-decimals)
  (ok u6))

;; ---- get-balance ----
(define-read-only (get-balance (who principal))
  (ok (ft-get-balance test-usdcx who)))

;; ---- get-total-supply ----
(define-read-only (get-total-supply)
  (ok (ft-get-supply test-usdcx)))

;; ---- get-token-uri ----
(define-read-only (get-token-uri)
  (ok none))

;; ---- mint(): 1 000 USD uma vez por tx-sender ----
(define-public (mint)
  (let ((have (default-to u0 (map-get? minted { who: tx-sender }))))
    (asserts! (is-eq have u0) (err u10))
    (map-set minted { who: tx-sender } MINT_AMOUNT)
    (try! (ft-mint? test-usdcx MINT_AMOUNT tx-sender))
    (ok true)))

;; ---- get-minted(who): u0 ou MINT_AMOUNT (para UI) ----
(define-read-only (get-minted (who principal))
  (default-to u0 (map-get? minted { who: who })))
