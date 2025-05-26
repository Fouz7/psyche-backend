-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_tests" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "healthTestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appetite" INTEGER,
    "interest" INTEGER,
    "fatigue" INTEGER,
    "worthlessness" INTEGER,
    "concentration" INTEGER,
    "agitation" INTEGER,
    "suicidalIdeation" INTEGER,
    "sleepDisturbance" INTEGER,
    "aggression" INTEGER,
    "panicAttacks" INTEGER,
    "hopelessness" INTEGER,
    "restlessness" INTEGER,
    "depressionState" INTEGER,
    "generatedSuggestion" VARCHAR(1024),

    CONSTRAINT "health_tests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- AddForeignKey
ALTER TABLE "health_tests" ADD CONSTRAINT "health_tests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
