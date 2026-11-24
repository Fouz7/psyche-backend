-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateTable
CREATE TABLE "health_test_embeddings" (
    "id" SERIAL NOT NULL,
    "healthTestId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768) NOT NULL,
    "embeddingModel" TEXT NOT NULL DEFAULT 'gemini-embedding-001',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_test_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "health_test_embeddings_healthTestId_key" ON "health_test_embeddings"("healthTestId");

-- CreateIndex
CREATE INDEX "health_test_embeddings_userId_idx" ON "health_test_embeddings"("userId");

-- CreateIndex
CREATE INDEX "health_test_embeddings_embedding_idx" ON "health_test_embeddings" USING hnsw ("embedding" vector_cosine_ops);

-- AddForeignKey
ALTER TABLE "health_test_embeddings" ADD CONSTRAINT "health_test_embeddings_healthTestId_fkey" FOREIGN KEY ("healthTestId") REFERENCES "health_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
