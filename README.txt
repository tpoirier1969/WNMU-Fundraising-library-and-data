Fishing Logbook v10.39.2

What changed
- rebuilt the Add Log form flow so Trip, Conditions, Type of Fishing, and Results read more cleanly
- renamed Angler Setup to Options in the main dock and added Map Options inside the sheet
- added map style choices, including Satellite
- added a Read Me sheet near Map Only with project overview and clearer sharing examples
- added a small expandable map search tool near the map controls
- split Rainbow Trout and Steelhead into separate species entries
- added Bottom Type and kept Wind Direction in Conditions
- added better Review filters and wired them to the actual list/map state
- made core Add Log fields visually flip from pending to complete
- kept more Add Log fields optional instead of treating the form like an audit
- reduced mobile input auto-zoom by using mobile-safe control sizing
- fixed Water Clarity / water-type condition handling so one live field is used instead of broken clones

Important Supabase note
- rerun supabase-setup.sql in Supabase if you want cloud sync to keep newer fields like wind direction, bottom type, and exact presentation depth

Notes
- review numeric filters accept exact values like 55, minimums like 55+, and maximums like 55-
- Map Only now works alongside Read Me and Search instead of hiding all the useful controls
- local save behavior is unchanged

- hotfix: bait type change now repopulates subtype and presentation fields
- hotfix: Steelhead restored as a separate species choice
- hotfix: generic Name / Choose fishing type first state removed until a relevant type is selected

- phone action dock compacted to a 2-column layout with the main actions in the requested order
- map/search/read me moved into the main dock; Cloud Sync naming standardized
- review list tightened up, stats compressed, and delete is limited to the angler who created the log when a matching angler key is present
- picker logic rebuilt toward a centered wheel-style anchored popover for Add Log and Options fields
- required-field validation now follows the new required list and jumps to the missing field
- saved filters persist between normal view and Map Only view on this device
