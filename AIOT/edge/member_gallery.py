"""Small, versioned member gallery; no model loading, camera, config or HTTP.

Compatibility IDs describe embedding spaces, not security guarantees. Legacy
profiles have no provenance: the explicit MBF adapter must never be used for R50.
"""
import hashlib
import copy
import json
import logging
import os
from pathlib import Path
import tempfile
import time

import numpy as np
from model_contract import LEGACY_CONTRACT

logger = logging.getLogger(__name__)
CACHE_SCHEMA_VERSION = 1
LEGACY_MBF_CONTRACT = LEGACY_CONTRACT


class GalleryFetchResult:
    """HTTP outcome, distinct from a valid empty snapshot. Data stays untrusted."""
    def __init__(self, success, *, data=None, contract=None, error=None):
        self.success = success
        self.data = data
        self.contract = contract
        self.error = error


def validate_contract(contract):
    if isinstance(contract, dict) and contract.get('mode') == 'experimental-cpu-only':
        from integration_gate import validate_candidate_contract
        return copy.deepcopy(validate_candidate_contract(contract))
    if not isinstance(contract, dict) or set(contract) != set(LEGACY_MBF_CONTRACT):
        raise ValueError("invalid_embedding_contract")
    if type(contract["dimension"]) is not int or contract["dimension"] != 512:
        raise ValueError("unsupported_embedding_dimension")
    if any(not isinstance(contract[k], str) or not contract[k].strip()
           for k in ("model_id", "preprocess_id", "alignment_id")):
        raise ValueError("invalid_embedding_contract")
    return dict(contract)


def validate_members(data, dimension=512):
    """Reject an invalid snapshot as a whole; never turn bad rows into data=[]."""
    if not isinstance(data, list):
        raise ValueError("gallery_data_not_list")
    result, codes = [], set()
    for item in data:
        if not isinstance(item, dict):
            raise ValueError("invalid_member")
        code = item.get("user_code")
        if not isinstance(code, str) or not code.strip() or code != code.strip().upper() or code in codes:
            raise ValueError("invalid_or_duplicate_member_code")
        name = item.get("full_name") or code
        if not isinstance(name, str):
            raise ValueError("invalid_member_name")
        raw = item.get("embedding")
        if not isinstance(raw, list) or any(type(x) not in (int, float) for x in raw):
            raise ValueError("invalid_embedding_numbers")
        vector = np.asarray(raw, dtype=np.float64)
        if vector.shape != (dimension,) or not np.isfinite(vector).all():
            raise ValueError("invalid_embedding_shape_or_values")
        norm = np.linalg.norm(vector)
        if not np.isfinite(norm) or norm < 1e-8:
            raise ValueError("zero_or_invalid_embedding")
        result.append({"user_code": code, "full_name": name, "embedding": vector / norm})
        codes.add(code)
    return sorted(result, key=lambda member: member["user_code"])


def serializable_members(entries):
    return [{"user_code": entry["user_code"], "full_name": entry["full_name"],
             "embedding": entry["embedding"].tolist()} for entry in entries]


def content_version(data, contract):
    canonical = json.dumps({"contract": contract, "data": data}, sort_keys=True,
                           separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


class MemberGallery:
    def __init__(self, cache_path, *, source, contract=None, allow_legacy=True,
                 max_age_seconds=86400, clock=None):
        self.path = Path(cache_path).expanduser().resolve()
        self.source = source.rstrip("/")
        self.contract = validate_contract(LEGACY_MBF_CONTRACT if contract is None else contract)
        if not np.isfinite(max_age_seconds) or max_age_seconds <= 0:
            raise ValueError("Gallery max age must be finite and positive")
        self.allow_legacy = allow_legacy and self.contract == LEGACY_MBF_CONTRACT
        self.max_age_seconds = max_age_seconds
        self.clock = clock or time.time
        self.entries = []
        self.version = None
        self.fetched_at = None
        self.origin = "none"
        self.error = None
        self.cache_error = None
        self._persisted_data = None

    def _fresh(self, stamp):
        return (type(stamp) in (int, float) and np.isfinite(stamp) and
                0 <= self.clock() - stamp <= self.max_age_seconds)

    def restore(self):
        """Missing/invalid cache leaves an empty gallery, not an exception."""
        try:
            snapshot = json.loads(self.path.read_text(encoding="utf-8"))
            if (not isinstance(snapshot, dict) or type(snapshot.get("cache_schema_version")) is not int
                    or snapshot["cache_schema_version"] != CACHE_SCHEMA_VERSION):
                raise ValueError("cache_schema_mismatch")
            if snapshot.get("source") != self.source:
                raise ValueError("cache_source_mismatch")
            if validate_contract(snapshot.get("contract")) != self.contract:
                raise ValueError("cache_model_contract_mismatch")
            if not self._fresh(snapshot.get("fetched_at")):
                raise ValueError("cache_expired_or_clock_invalid")
            data = snapshot.get("data")
            entries = validate_members(data, self.contract["dimension"])
            if snapshot.get("gallery_version") != content_version(data, self.contract):
                raise ValueError("cache_revision_mismatch")
        except (OSError, ValueError, TypeError, OverflowError) as exc:
            self.entries, self.version, self.fetched_at = [], None, None
            self._persisted_data = None
            self.origin = "none"
            self.error = str(exc) if isinstance(exc, ValueError) else "cache_unavailable"
            return False
        self.entries = entries
        self._persisted_data = data
        self.version = snapshot["gallery_version"]
        self.fetched_at = snapshot["fetched_at"]
        self.origin, self.error = "cache", None
        return True  # An empty snapshot is valid and must not resurrect old users.

    def _save(self, snapshot):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                             prefix=self.path.name + ".", suffix=".tmp", delete=False) as file:
                temporary = Path(file.name)
                json.dump(snapshot, file, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, self.path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

    def _fallback(self, error):
        self.error = error
        if self.fetched_at is not None and self._fresh(self.fetched_at):
            self.origin = "cache"
        else:
            self.entries, self.version, self.fetched_at = [], None, None
            self._persisted_data = None
            self.origin = "none"
        logger.warning("Member gallery refresh failed (%s); using %s, %d members",
                       error, self.origin, len(self.entries))
        return False

    def refresh(self, api_client):
        fetched = api_client.get_face_data()
        if not fetched.success:
            return self._fallback(fetched.error)
        try:
            if fetched.contract is None:
                if not (self.allow_legacy and self.contract == LEGACY_MBF_CONTRACT):
                    raise ValueError("missing_embedding_contract")
            elif validate_contract(fetched.contract) != self.contract:
                raise ValueError("model_contract_mismatch")
            entries = validate_members(fetched.data, self.contract["dimension"])
            data = serializable_members(entries)
            # Preserve exact serialized values after restore if content is unchanged;
            # repeated L2 normalization must not churn revision at floating-point noise.
            if self._persisted_data is not None and fetched.data == self._persisted_data:
                data = self._persisted_data
            version = content_version(data, self.contract)
        except (ValueError, TypeError, OverflowError) as exc:
            return self._fallback(str(exc))
        stamp = self.clock()
        snapshot = {"cache_schema_version": CACHE_SCHEMA_VERSION, "source": self.source,
                    "contract": self.contract, "gallery_version": version,
                    "fetched_at": stamp, "data": data}
        self.cache_error = None
        try:
            self._save(snapshot)
        except OSError:
            # A newly received member removal is authoritative in RAM. Do not leave
            # an old disk cache to restore on the next offline restart if possible.
            self.cache_error = "cache_write_failed"
            try:
                self.path.unlink(missing_ok=True)
            except OSError:
                self.cache_error = "cache_write_and_invalidation_failed"
            logger.warning("Gallery cache persistence failed: %s", self.cache_error)
        self.entries, self.version, self.fetched_at = entries, version, stamp
        self._persisted_data = data
        self.origin, self.error = "server", None
        return True

    def valid_query(self, embedding):
        try:
            vector = np.asarray(embedding, dtype=np.float64)
            norm = np.linalg.norm(vector)
            return (vector.shape == (self.contract["dimension"],) and
                    np.isfinite(vector).all() and np.isfinite(norm) and norm > 1e-8)
        except (ValueError, TypeError):
            return False

    def expire(self):
        """Expiry is checked on use too, not only on a periodic failed refresh."""
        if self.fetched_at is not None and not self._fresh(self.fetched_at):
            self._fallback('cache_expired_or_clock_invalid')
            return True
        return False

    def status(self):
        return {"origin": self.origin, "member_count": len(self.entries),
                "gallery_version": self.version, "fetched_at": self.fetched_at,
                "error": self.error, "cache_error": self.cache_error}
