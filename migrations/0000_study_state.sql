CREATE TABLE `study_states` (
  `owner_id` text PRIMARY KEY NOT NULL,
  `revision` integer NOT NULL CHECK (`revision` >= 1),
  `snapshot` text NOT NULL,
  `updated_at` text NOT NULL
);
