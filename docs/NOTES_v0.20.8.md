# v0.20.8

- replaced scheduler start/end native date inputs with segmented month/day/year selectors
- stores dates only after a complete valid year-month-day is chosen
- blocks accidental year corruption like 0020 from getting saved back into the fundraiser draft
