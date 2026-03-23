-- CreateTable
CREATE TABLE "webview_bridge_token" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webview_bridge_token_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "webview_bridge_token_token_key" ON "webview_bridge_token"("token");

-- CreateIndex
CREATE INDEX "webview_bridge_token_member_id_idx" ON "webview_bridge_token"("member_id");

-- CreateIndex
CREATE INDEX "webview_bridge_token_expires_at_idx" ON "webview_bridge_token"("expires_at");

-- AddForeignKey
ALTER TABLE "webview_bridge_token" ADD CONSTRAINT "webview_bridge_token_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
