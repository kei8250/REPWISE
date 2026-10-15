ALTER TABLE `exercise_master` ADD `load_basis` text DEFAULT 'per_rep' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_set` ADD `role` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_set` ADD `load_basis` text DEFAULT 'per_rep' NOT NULL;