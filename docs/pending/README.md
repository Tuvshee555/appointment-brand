# Pending changes

Work that is finished but not wanted in `main` yet is kept here as a patch, so `main`
stays the only branch.

- `online-school.patch` — three commits from the old `online-school` branch (15 Nov 2026):
  rebrands this demo from the salon «Сувд» to an online school «Оюун» (copy, vocabulary,
  assistant gate set, held-out conversations). Not applied: the salon is a live sales demo.
  To build an online-school demo from it, apply it on a new branch or a copy of the repo:

  ```bash
  git am docs/pending/online-school.patch
  ```
