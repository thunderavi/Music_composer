from functools import lru_cache
from pathlib import Path
from typing import List

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    app_name: str = Field(default="Music Composition Agent", alias="APP_NAME")
    node_env: str = Field(default="development", alias="NODE_ENV")
    host: str = Field(default="0.0.0.0", alias="HOST")
    port: int = Field(default=5050, alias="PORT")
    api_prefix: str = Field(default="/api/v1", alias="API_PREFIX")
    nim_api_key: str = Field(default="", validation_alias=AliasChoices("NVIDIA_API_KEY", "NIM_API_KEY"))
    nim_base_url: str = Field(
        default="https://integrate.api.nvidia.com",
        validation_alias=AliasChoices("NVIDIA_NIM_BASE_URL", "NIM_BASE_URL"),
    )
    nim_model: str = Field(
        default="nvidia/llama-3.1-nemotron-nano-8b-v1",
        validation_alias=AliasChoices("NVIDIA_NIM_MODEL", "NIM_MODEL"),
    )
    app_database_path: str = Field(default="./data/drafts.db", alias="APP_DATABASE_PATH")
    allowed_origins: str = Field(
        default="*",
        validation_alias=AliasChoices("CORS_ORIGIN", "ALLOWED_ORIGINS"),
    )

    model_config = SettingsConfigDict(env_file=ENV_FILE, env_file_encoding="utf-8", extra="ignore")

    @property
    def origins(self) -> List[str]:
        if self.allowed_origins.strip() == "*":
            return ["*"]
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def normalized_api_prefix(self) -> str:
        prefix = self.api_prefix.strip() or "/api/v1"
        return prefix if prefix.startswith("/") else f"/{prefix}"

    @property
    def normalized_nim_base_url(self) -> str:
        base_url = self.nim_base_url.rstrip("/")
        if base_url.endswith("/v1"):
            return base_url
        return f"{base_url}/v1"


@lru_cache
def get_settings() -> Settings:
    return Settings()
