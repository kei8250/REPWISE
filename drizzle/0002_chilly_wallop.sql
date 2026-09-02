CREATE TABLE `processed_mutation` (
	`mutation_id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'default' NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`operation` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`result_json` text NOT NULL,
	`processed_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_processed_mutation_owner_entity` ON `processed_mutation` (`owner_id`,`entity_type`,`entity_id`);