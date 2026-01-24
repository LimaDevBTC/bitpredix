;; Bitpredix — Estrutura base do contrato (Sprint 1)
;; Lógica completa: Sprint 2. Ref: docs/TOKEN_ARCHITECTURE.md, docs/FUNDS_ARCHITECTURE.md

;; Rodadas: round-id -> dados da rodada
(define-map rounds
  { round-id: uint }
  {
    start-at: uint,
    ends-at: uint,
    price-at-start: uint,
    status: (string-ascii 10),
    pool-up: uint,
    pool-down: uint
  })

;; Posições por rodada e usuário: (round-id, user, side) -> shares, cost, settled
(define-map positions
  { round-id: uint, user: principal, side: (string-ascii 4) }
  { shares: uint, cost: uint, settled: bool })

;; ---- Funções públicas (stubs — implementação no Sprint 2) ----

(define-public (create-round (round-id uint) (price-at-start uint))
  (ok true))

(define-public (place-bet (round-id uint) (side (string-ascii 4)) (amount-usd uint))
  (ok true))

(define-public (resolve-round (round-id uint) (price-at-end uint) (outcome (string-ascii 4)))
  (ok true))

(define-public (claim-winnings (round-id uint))
  (ok true))
