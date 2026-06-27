from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Security
    secret_key: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24 * 7  # 7 days

    # Deriv OAuth2 PKCE (register app at https://api.deriv.com/dashboard)
    deriv_client_id: str = ""          # OAuth2 client_id from Deriv dashboard
    deriv_app_id: str = "1089"         # App ID (for WS legacy + Deriv-App-ID header)
    deriv_redirect_uri: str = "http://localhost:5173/auth/callback"

    # Affiliate tracking (from Deriv partner dashboard)
    affiliate_id: str = ""             # e.g. CU303219
    affiliate_sidc: str = ""           # session GUID from partner dashboard
    affiliate_campaign: str = "dst"

    # Redis (for OTP WS URL cache + signal cache)
    redis_url: str = "redis://localhost:6379"

    # Claude API
    anthropic_api_key: str = ""

    # DB (only needed from Phase 6)
    database_url: str = "postgresql://dst:dst@localhost:5432/dst"

    class Config:
        env_file = ".env"


settings = Settings()
