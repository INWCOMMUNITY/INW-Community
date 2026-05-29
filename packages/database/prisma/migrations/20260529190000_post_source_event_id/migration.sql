-- Share events to the feed: reference the shared event on the feed post.

ALTER TABLE "Post" ADD COLUMN "source_event_id" TEXT;
