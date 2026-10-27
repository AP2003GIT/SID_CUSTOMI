CREATE TABLE `league_states` (
	`id` integer PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_by` text NOT NULL
);
