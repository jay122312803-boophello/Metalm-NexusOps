import json
import uuid
import os
from seed import ensure_seeded

class JsonStorage:
    def __init__(self, file_path=None):
        if file_path is None:
            # Use absolute path relative to this file
            base_dir = os.path.dirname(os.path.abspath(__file__))
            file_path = os.path.join(base_dir, "data", "db.json")
            
        self.file_path = file_path
        self._ensure_file()
        self.data = self._load()
        ensure_seeded(self)

    def _ensure_file(self):
        if not os.path.exists(os.path.dirname(self.file_path)):
            os.makedirs(os.path.dirname(self.file_path))
        if not os.path.exists(self.file_path):
            with open(self.file_path, 'w', encoding='utf-8') as f:
                json.dump({
                    "servers": [],
                    "repos": [],
                    "deployments": [],
                    "history": []
                }, f, ensure_ascii=False, indent=2)

    def _load(self):
        try:
            with open(self.file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {"servers": [], "repos": [], "deployments": [], "history": []}

    def _save(self):
        with open(self.file_path, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, ensure_ascii=False, indent=2)

    def get_all(self, collection: str):
        return self.data.get(collection, [])

    def get_by_id(self, collection: str, item_id: str):
        items = self.data.get(collection, [])
        for item in items:
            if item.get("id") == item_id:
                return item
        return None

    def add(self, collection: str, item: dict):
        if "id" not in item:
            item["id"] = str(uuid.uuid4())
        
        # Ensure collections exist
        if collection not in self.data:
            self.data[collection] = []
            
        self.data[collection].append(item)
        self._save()
        return item

    def update(self, collection: str, item_id: str, updates: dict):
        items = self.data.get(collection, [])
        for item in items:
            if item.get("id") == item_id:
                item.update(updates)
                self._save()
                return item
        return None

    def delete(self, collection: str, item_id: str):
        if collection in self.data:
            self.data[collection] = [i for i in self.data[collection] if i.get("id") != item_id]
            self._save()
            return True
        return False

storage = JsonStorage()
