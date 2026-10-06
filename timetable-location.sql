-- Extract the trailing room/address label for existing ORTUS events.
-- Keeps titles, identifiers and non-empty locations unchanged.
update public.calendar_events
set location = trim(substring(title from '\(([^()]*[0-9]+[[:space:]]*-[[:space:]]*[0-9]+[^()]*)\)[[:space:]]*$'))
where external_id like 'ortus-%'
  and coalesce(location, '') = ''
  and title ~ '\([^()]*[0-9]+[[:space:]]*-[[:space:]]*[0-9]+[^()]*\)[[:space:]]*$';
