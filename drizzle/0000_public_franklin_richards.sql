CREATE TABLE `coach_messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`body_part` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_exercises_body_part` ON `exercises` (`body_part`);--> statement-breakpoint
CREATE TABLE `workout_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`workout_date` text NOT NULL,
	`title` text NOT NULL,
	`body_part` text NOT NULL,
	`duration_minutes` integer,
	`rating` integer,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_workout_sessions_date` ON `workout_sessions` (`workout_date`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`exercise_name` text NOT NULL,
	`set_number` integer NOT NULL,
	`weight` integer NOT NULL,
	`reps` integer NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `workout_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workout_sets_session` ON `workout_sets` (`session_id`);--> statement-breakpoint
CREATE INDEX `idx_workout_sets_exercise` ON `workout_sets` (`exercise_name`);
--> statement-breakpoint
PRAGMA optimize;
