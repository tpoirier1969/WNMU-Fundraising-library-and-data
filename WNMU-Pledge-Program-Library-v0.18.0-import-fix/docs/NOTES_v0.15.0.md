# Notes v0.15.0

## Admin add-program workflow
This release adds the first proper admin-side create flow for pledge titles.

### Behavior
- visible only when signed in as admin
- opens the detail modal directly in create mode
- hides the read-only history sections while creating a title
- requires title and NOLA
- warns on duplicate title
- blocks duplicate NOLA
- after create, refreshes the library and reopens the new title in standard detail mode

## Design choice
The create flow deliberately stays narrow: it creates the base `pledge_programs_v2` row only. Timings, premiums, and manual money editing remain separate next-step work.
