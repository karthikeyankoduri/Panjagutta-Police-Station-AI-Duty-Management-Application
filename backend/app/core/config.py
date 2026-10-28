from __future__ import annotations
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    APP_ENV: str = "development"
    APP_SECRET_KEY: str = "change-me-in-production"
    APP_DEBUG: bool = True

    # Database
    DATABASE_URL: str = "postgresql+asyncpg://panjagutta_user:password@localhost:5432/panjagutta_duty"

    # JWT
    JWT_SECRET_KEY: str = "change-me-jwt-secret"
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Auth security
    AUTH_MAX_FAILED_ATTEMPTS: int = 5
    AUTH_LOCKOUT_MINUTES: int = 15
    AUTH_INACTIVITY_TIMEOUT_MINUTES: int = 60

    # Demo / seed
    SEED_DEMO_DATA: bool = True
    DEMO_POLICY_ENABLED: bool = True

    # AI Provider – default off
    AI_PROVIDER: str = "none"
    AI_API_KEY: str = "NOT_SET"
    AI_BASE_URL: str = "http://localhost:11434"

    # Reports
    REPORTS_DIR: str = "./generated_reports"

    # CORS
    CORS_ALLOWED_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:8000,http://127.0.0.1:8000"
    CORS_ORIGINS: str = ""

    @property
    def cors_origins_list(self) -> List[str]:
        raw = self.CORS_ORIGINS if self.CORS_ORIGINS else self.CORS_ALLOWED_ORIGINS
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        # Always guarantee local dev origins
        defaults = ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:8000", "http://127.0.0.1:8000"]
        for d in defaults:
            if d not in origins:
                origins.append(d)
        return origins


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
