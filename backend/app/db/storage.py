import json
import os
import uuid
from typing import Any, Dict, List, Optional

from .seed import ensure_seeded, migrate_legacy_db_if_needed


class JsonStorage:
    def __init__(self, file_path: Optional[str] = None):
        if file_path is None:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            file_path = os.path.join(base_dir, "..", "..", "data", "db.json")
            file_path = os.path.abspath(file_path)

        self.file_path = file_path
        migrate_legacy_db_if_needed(self.file_path)
        self._ensure_file()
        self.data = self._load()
        ensure_seeded(self)

    def _ensure_file(self) -> None:
        os.makedirs(os.path.dirname(self.file_path), exist_ok=True)
        if not os.path.exists(self.file_path):
            with open(self.file_path, "w", encoding="utf-8") as f:
                json.dump({"servers": [], "repos": [], "deployments": [], "history": []}, f, indent=2, ensure_ascii=False)

    def _load(self) -> Dict[str, Any]:
        with open(self.file_path, "r", encoding="utf-8") as f:
            try:
                data = json.load(f)
            except Exception:
                data = {"servers": [], "repos": [], "deployments": [], "history": []}
        for k in ["servers", "repos", "deployments", "history"]:
            if k not in data or not isinstance(data[k], list):
                data[k] = []
        return data

    def _save(self) -> None:
        with open(self.file_path, "w", encoding="utf-8") as f:
            json.dump(self.data, f, indent=2, ensure_ascii=False)

    def get_all(self, collection: str) -> List[Dict[str, Any]]:
        return list(self.data.get(collection, []))

    def get_by_id(self, collection: str, item_id: str) -> Optional[Dict[str, Any]]:
        for item in self.data.get(collection, []):
            if item.get("id") == item_id:
                return item
        return None

    def add(self, collection: str, item: Dict[str, Any]) -> Dict[str, Any]:
        if not item.get("id"):
            item["id"] = str(uuid.uuid4())
        self.data[collection].append(item)
        self._save()
        return item

    def update(self, collection: str, item_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        for i, item in enumerate(self.data.get(collection, [])):
            if item.get("id") == item_id:
                self.data[collection][i] = {**item, **updates}
                self._save()
                return self.data[collection][i]
        return None

    def delete(self, collection: str, item_id: str) -> bool:
        items = self.data.get(collection, [])
        for i, item in enumerate(items):
            if item.get("id") == item_id:
                del items[i]
                self._save()
                return True
        return False

