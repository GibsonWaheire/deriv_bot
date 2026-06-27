from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql://dst:dst@localhost:5432/dst"
    redis_url: str = "redis://localhost:6379"
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days
    deriv_app_id: str = "1089"
    affiliate_id: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
