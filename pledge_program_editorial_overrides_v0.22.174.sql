-- v0.22.174
-- Expand Programmer Rating to six stored levels and preserve legacy aliases.
-- "Unrated" remains the absence of a row; Neutral is now an explicit stored rating.

alter table public.pledge_program_editorial_overrides
  drop constraint if exists pledge_program_editorial_overrides_rating_check;

alter table public.pledge_program_editorial_overrides
  add constraint pledge_program_editorial_overrides_rating_check
  check (rating in (
    'dont_air',
    'low_confidence',
    'neutral',
    'viable',
    'promising',
    'must_air',
    'high',
    'medium',
    'low'
  ));
