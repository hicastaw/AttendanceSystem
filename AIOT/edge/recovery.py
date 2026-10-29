"""Finite retries for transient SDK/I/O faults; never catch programming errors.

Retries do not create replacement events, switch models or fall back to mock.
Native driver calls still require driver timeouts / supervisor watchdog on target.
"""
import logging
import math
import time
import sqlite3
import cv2
import requests


class WorkerStopping(Exception):
    pass


class RecoveryExhausted(RuntimeError):
    pass


class Recovery:
    def __init__(self, *, attempts=5, base=.25, maximum=2, running=lambda: True,
                 failure=lambda component: None, success=lambda component: None, sleep=time.sleep):
        if type(attempts) is not int or not 1 <= attempts <= 32 or not all(
                math.isfinite(x) and x > 0 for x in (base, maximum)) or maximum < base:
            raise ValueError('Invalid finite recovery budget')
        self.attempts, self.base, self.maximum = attempts, base, maximum
        self.running, self.failure, self.sleep = running, failure, sleep
        self.success = success

    def call(self, component, action):
        for attempt in range(self.attempts):
            if not self.running():
                raise WorkerStopping()
            try:
                result = action()
                self.success(component)
                return result
            except (OSError, sqlite3.Error, cv2.error, requests.RequestException) as error:
                code=getattr(error,'sqlite_errorcode',None)
                if isinstance(error,sqlite3.Error) and code is not None and (code & 255) not in {
                        sqlite3.SQLITE_BUSY,sqlite3.SQLITE_LOCKED,sqlite3.SQLITE_IOERR,sqlite3.SQLITE_FULL,
                        sqlite3.SQLITE_CANTOPEN,sqlite3.SQLITE_READONLY,sqlite3.SQLITE_NOMEM,sqlite3.SQLITE_PROTOCOL}:
                    self.failure(component)
                    raise  # Corrupt/schema/constraint faults are not transient I/O.
                self.failure(component)
                logging.getLogger(__name__).warning('component=%s fault=%s attempt=%s/%s',
                    component, type(error).__name__, attempt + 1, self.attempts)
                if attempt + 1 == self.attempts:
                    raise RecoveryExhausted('Recovery budget exhausted: ' + component) from error
                remaining = min(self.maximum, self.base * 2 ** attempt)
                while remaining > 0:
                    if not self.running():
                        raise WorkerStopping()
                    step = min(.1, remaining)
                    self.sleep(step)
                    remaining -= step
