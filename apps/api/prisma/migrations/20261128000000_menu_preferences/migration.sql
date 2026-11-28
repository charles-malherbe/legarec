-- The menu of the espace, remembered in the profile as the theme is (DECISIONS.md, 28/11/2026): reduced to its icons,
-- and the groups the person closed, by their key ('rec', 'doc'...). Nothing of a case: the keys are the only content.
ALTER TABLE users
  ADD COLUMN menu_collapsed boolean NOT NULL DEFAULT false,
  ADD COLUMN menu_closed_groups text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT users_menu_closed_groups CHECK (cardinality(menu_closed_groups) <= 10);

-- One's own account, as the other preferences (policy self_change): read and changed by the staff.
GRANT SELECT (menu_collapsed, menu_closed_groups), UPDATE (menu_collapsed, menu_closed_groups) ON users TO legarec_staff;
