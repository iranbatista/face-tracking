from pydantic import BaseModel


class AdminSession(BaseModel):
    enabled: bool
    logged_in: bool


class FeatureInfo(BaseModel):
    key: str
    label: str
    description: str
    enabled: bool
