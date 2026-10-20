"""Local Excel write compatibility. Bump a family when its workbook contract changes."""
from typing import ClassVar
from pydantic import BaseModel, Field, model_validator

TEMPLATE_VERSIONS = {
    "masters": "master-5",
    "products": "product-2",
    "opportunities": "opportunity-4",
    "requests": "request-2",
}

class TemplateBatch(BaseModel):
    template_kind: ClassVar[str]
    template_version: str | None = Field(None, max_length=64, strict=True)

    @model_validator(mode="before")
    @classmethod
    def current_template(cls, values):
        if isinstance(values, dict) and values.get("template_version") != TEMPLATE_VERSIONS[cls.template_kind]:
            raise ValueError("This Excel template is outdated or unsupported. Download a fresh "+cls.template_kind+" template, then reapply your unsaved changes. No data was saved.")
        return values
