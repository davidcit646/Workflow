#!/usr/bin/env python3
"""
Workflow Tracker GUI
Track employee onboarding progress with blocks of tea :).
Builders: David Citarelli, GitHub Copilot
"""

import sys
import tkinter as tk
from tkinter import ttk, messagebox, simpledialog, scrolledtext
import os
import json
import subprocess
import re
import threading
from datetime import datetime, timedelta
import hashlib
import uuid
import binascii
import secrets
import ctypes
import logging
import struct
import tempfile
from functools import lru_cache
from typing import Optional, List, Dict, Any, Tuple

# Module-level constants
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DATA_DIR = os.path.join(os.path.expanduser("~"), "Documents", "Workflow")
APP_VERSION = "1.0.0"


def ensure_dirs(*paths: str) -> None:
    try:
        for p in paths:
            if p:
                os.makedirs(p, exist_ok=True)
    except OSError:
        pass

# Logging setup (file-based debug log)
ensure_dirs(APP_DATA_DIR)
try:
    _log_path = os.path.join(APP_DATA_DIR, "workflow_debug.log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        filename=_log_path,
        filemode="a",
    )
except (OSError, IOError, ValueError):
    pass
logger = logging.getLogger("workflow")

# Add local vendor directory to import path for bundled libraries
try:
    _VENDOR_DIR = os.path.join(BASE_DIR, 'vendor')
    if os.path.isdir(_VENDOR_DIR) and _VENDOR_DIR not in sys.path:
        sys.path.insert(0, _VENDOR_DIR)
except (OSError, IOError):
    pass

# ============================================================================
# TYPOGRAPHY
# ============================================================================
FONTS = {
    "title": ("Verdana", 20, "bold"),
    "header": ("Verdana", 18, "bold"),
    "subheader": ("Verdana", 14, "bold"),
    "subtext_bold": ("Verdana", 12, "bold"),
    "small": ("Verdana", 10),
    "small_bold": ("Verdana", 10, "bold"),
    "body": ("Verdana", 11),
    "mono": ("Consolas", 11),
    "button": ("Verdana", 11, "bold"),
    "tiny": ("Verdana", 10),
    "tiny_bold": ("Verdana", 10, "bold"),
    "muted": ("Verdana", 9),
    "muted_bold": ("Verdana", 9, "bold"),
    "micro": ("Verdana", 8),
    "micro_bold": ("Verdana", 8, "bold"),
}

# ============================================================================
# COLOR PALETTES
# ============================================================================
LIGHT_PALETTE = {
    "bg_color": "#e2e6e9",
    "fg_color": "#2c3e50",
    "accent_color": "#3498db",
    "ribbon_color": "#3498db",
    "button_color": "#27ae60",
    "error_color": "#e74c3c",
    "warning_color": "#f39c12",
    "card_bg_color": "#ffffff",
    "checkbox_select_color": "#ffffff",
}

DARK_PALETTE = {
    "bg_color": "#121212",
    "fg_color": "#ecf0f1",
    "accent_color": "#4ea0ff",
    "ribbon_color": "#8F00FF",
    "button_color": "#2ecc71",
    "error_color": "#e74c3c",
    "warning_color": "#f39c12",
    "card_bg_color": "#2c2f33",
    "checkbox_select_color": "#000000",
}

CURRENT_PALETTE = LIGHT_PALETTE.copy()

# ============================================================================
# BUTTON STYLING
# ============================================================================
BUTTON_ROLE_COLORS = {
    "confirm": ("#27ae60", "#229954"),
    "save": ("#27ae60", "#229954"),
    "continue": ("#27ae60", "#229954"),
    "add": ("#27ae60", "#229954"),
    "edit": ("#f1c40f", "#d4ac0d"),
    "cancel": ("#e74c3c", "#c0392b"),
    "delete": ("#e74c3c", "#c0392b"),
    "archive": ("#2980b9", "#1f618d"),
    "view": ("#2980b9", "#1f618d"),
    "charcoal": ("#c3c9ce", "#b5bcc2"),
    "default": ("#3498db", "#2e86c1"),
}

ALWAYS_BLACK_TEXT_ROLES = {"add", "view", "delete"}
BUTTON_OUTLINE_COLOR = "#7f8c8d"
BUTTON_INTERNAL_PADX = 3
BUTTON_INTERNAL_PADY = 2
BUTTON_PACK_IPADY = 1

# ============================================================================
# ENCRYPTION & SECURITY
# ============================================================================
PASSWORD_ITERATIONS = 200_000
PASSWORD_SALT_BYTES = 16
ENCRYPTION_ITERATIONS = 100_000
OPENSSL_CMD = "openssl"

# ============================================================================
# FILE PATHS & DIRECTORIES
# ============================================================================
ARCHIVE_DIR_NAME = "Archive"
EXPORTS_DIR_NAME = "exports"
THEME_PREF_FILE = "theme_pref.json"

# ==========================================================================
# WEEKLY TRACKER CONSTANTS
# ==========================================================================
WEEKDAY_NAMES = [
    "Friday",
    "Saturday",
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
]
NO_ENTRIES_TEXT = "(No entries for this day)"
NO_ACTIVITIES_TEXT = "(No activities entered)"
TRACKER_DIR_NAME = "WeeklyTracker"

# ============================================================================
# APPLICATION SETTINGS
# ============================================================================
SCROLL_TOP_OFFSET = 80
SCROLL_VIEW_MARGIN = 12
AUTOSAVE_INTERVAL_MS = 60_000

# ============================================================================
# DATA MAPPINGS
# ============================================================================
CODE_MAPS = {
    'CORI Status': [("None", "NONE"), ("Required", "REQ"), ("Submitted", "SUB"), ("Cleared", "CLR")],
    'NH GC Status': [("None", "NONE"), ("Required", "REQ"), ("Cleared", "CLR")],
    'ME GC Status': [("None", "NONE"), ("Required", "REQ"), ("Sent to Denise", "SEND")],
    'Deposit Account Type': [("", ""), ("Checking", "CHK"), ("Savings", "SAV")],
    'Shirt Size': [
        ("6XL", "6XL"), ("5XL", "5XL"), ("4XL", "4XL"), ("3XL", "3XL"),
        ("2XL", "2XL"), ("XL", "XL"), ("LG", "LG"), ("MD", "MD"),
        ("SM", "SM"), ("XS", "XS")
    ],
}

STATUS_FIELDS = ['CORI Status', 'NH GC Status', 'ME GC Status', 'Deposit Account Type', 'Shirt Size']
BRANCH_OPTIONS = ["All", "Salem", "Portland"]

CSV_EXPORT_FIELDS = [
    'Scheduled', 'Name', 'Employee ID', 'ICIMS ID', 'Job Name', 'Job Location',
    'Manager Name', 'Branch', 'NEO Scheduled Date', 'Background Completion Date',
    'CORI Status', 'CORI Submit Date', 'CORI Cleared Date',
    'NH GC Status', 'NH GC ID Number', 'NH GC Expiration Date',
    'ME GC Status', 'ME GC Sent Date', 'MVR', 'DOD Clearance',
    'Deposit Account Type', 'Bank Name', 'Routing Number', 'Account Number',
    'Candidate Phone Number', 'Candidate Email',
]

# ============================================================================
# UI DIMENSIONS & STYLING
# ============================================================================
WIDGET_WIDTHS = {
    'branch_combo': 10,
    'manager_combo': 18,
    'search_entry': 22,
    'form_entry_small': 8,
    'form_entry_medium': 10,
    'form_entry_large': 15,
}

BUTTON_WIDTHS = {
    'dialog_button': 9,
    'dialog_action': 8,
    'action_button': 8,
    'export_button': 8,
    'tools_button': 16,
}

PADDING = {
    'default': (4, 4),
    'tight': (2, 4),
    'loose': (6, 4),
    'section_top': (10, 0),
    'inline': (4, 8),
    'info_bar': (2, 0),
    'badge': (2, 10),
}

PADDING_H = {
    'tight': 4,
    'standard': 6,
    'medium': 10,
    'loose': 15,
}

SEPARATOR_COLOR = "#bdc3c7"

TEXT_COLORS = {
    'label_muted': "#7f8c8d",
    'label_dark_blue': "#1a3a5a",
    'label_light_blue': "#87CEEB",
    'label_header_blue': "#4ea0ff",
    'section_unscheduled': "#e74c3c",
    'section_scheduled': "#27ae60",
}

NEO_BADGE_COLORS = {
    'today': ("#39FF14", "black"),
    'future': ("#27ae60", "black"),
    'default': ("#f1c40f", "black"),
}

UNIFORM_STATUS_ISSUED = "ISSUED"
UNIFORM_STATUS_NOT_ISSUED = "NOT ISSUED"
UNIFORM_STATUS_ISSUED_COLOR = "#27ae60"
UNIFORM_STATUS_NOT_ISSUED_COLOR = "#e74c3c"

# Additional configuration constants
DIALOG_FIELD_LABELS = {
    'branch': "Branch:",
    'bg_date': "BG Date:",
    'cori': "CORI:",
    'cori_date': "CORI Date:",
    'nh_gc': "NH Good Character:",
    'nh_id_exp': "NH ID Exp:",
    'me_gc': "ME Good Character:",
    'me_sent_date': "ME Sent Date:",
    'account_type': "Account Type:",
    'bank_name': "Bank Name:",
    'routing': "Routing:",
    'account': "Account:",
}

LABEL_TEXT = {
    'required_items': "Required Items:",
    'unscheduled_section': "UNSCHEDULED",
    'scheduled_section': "SCHEDULED NEO",
    'section_uniforms': " Uniform ",
    'uniform_issued': "Issued",
}

REQUIRED_ITEMS = [
    ("Drug Test", "Drug Test"),
    ("Onboarding Packets", "Onboarding"),
    ("I-9 Section 1", "I-9 Section"),
]

# Dialog sections and field labels
DIALOG_SECTIONS = {
    'basic_info': " Basic Information ",
    'contact_info': " Contact info ",
    'personal_info': " Personal info ",
    'license_clearance': " Licensing & Clearance ",
    'emergency_contact': " Emergency Contact ",
    'clearances': " Licensing & Clearances ",
    'direct_deposit': " Direct Deposit Info ",
}

BASIC_INFO_FIELDS = [
    ("Name", "Name"),
    ("ICIMS ID", "ICIMS ID"),
    ("Employee ID", "Employee ID"),
    ("Job Name", "Job Name"),
    ("Job Location", "Job Location"),
    ("Manager Name", "Manager Name"),
    ("NEO Scheduled Date", "NEO Scheduled Date"),
]

LICENSE_FIELDS = [
    ("NH GC ID Number", "NH GC ID Number"),
    ("NH GC Expiration Date", "NH GC Expiration Date"),
    ("Background Completion Date", "Background Completion Date"),
]

EMERGENCY_CONTACT_FIELDS = [
    ("First Name", "EC First Name"),
    ("Last Name", "EC Last Name"),
    ("Relationship", "EC Relationship"),
    ("Phone Number", "EC Phone Number"),
]

PERSONAL_ID_FIELDS = ["State", "ID No.", "Exp.", "DOB", "Social"]

ARCHIVE_SECTIONS = {
    'candidate_info': "Candidate Info",
    'neo_hours': "NEO Hours",
    'uniform_sizes': "Uniform Sizes",
    'notes': "Notes",
}

FLASH_COLORS = {
    'highlight': "#fff3bf",
    'hold_ms': 100,
    'fade_ms': 1000,
    'fade_steps': 20,
}

CLEARANCE_LABELS = {
    'mvr': "MVR",
    'dod': "DOD Clearance",
    'required': "Required",
    'submitted': "Submitted",
    'cleared': "Cleared",
    'sent_to_denise': "Sent to Denise",
}

# Status constants
STATUS_NONE = "None"
STATUS_REQUIRED = "Required"
STATUS_SUBMITTED = "Submitted"
STATUS_CLEARED = "Cleared"
STATUS_SENT_TO_DENISE = "Sent to Denise"


# ============================================================================
# PASSWORD HASHING
# ============================================================================
def _hash_password(password: str, salt: bytes | None = None, iterations: int = PASSWORD_ITERATIONS):
    if salt is None:
        salt = secrets.token_bytes(PASSWORD_SALT_BYTES)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return {
        'salt': salt.hex(),
        'iterations': iterations,
        'key': key.hex()
    }


def _verify_password(password: str, salt_hex: str, iterations: int, key_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return secrets.compare_digest(binascii.hexlify(key).decode(), key_hex)





class SecurityManager:
    """Handles AES-256-CBC encryption via OpenSSL subprocess calls."""
    def __init__(self, password):
        # Ensure password is a usable string; callers should set this.
        self.password = password if isinstance(password, str) else ("" if password is None else str(password))
        self._lib = None
        # Try to load libcrypto for in-process encryption/decryption
        for name in ("libcrypto.so", "libcrypto.so.3", "libcrypto.dylib", "libeay32.dll", "libcrypto-1_1.dll"):
            try:
                self._lib = ctypes.CDLL(name)
                break
            except OSError:
                continue

    def decrypt(self, encrypted_file):
        """Decrypts a file and returns the plain text string."""
        # Read encrypted bytes
        try:
            with open(encrypted_file, 'rb') as f:
                enc = f.read()
        except (OSError, IOError):
            return None

        # If we have libcrypto, try in-process decrypt (our own file format)
        if self._lib is not None:
            try:
                plain = self._decrypt_bytes_with_lib(enc)
                if plain is None:
                    # fallback to CLI for legacy files
                    raise RuntimeError("libcrypto failed")
                try:
                    return plain.decode('utf-8')
                except UnicodeDecodeError:
                    return plain.decode('utf-8', errors='replace')
            except (RuntimeError, ValueError):
                pass

        # Fallback: use OpenSSL CLI (legacy compat)
        try:
            if not self.password:
                return None
            result = subprocess.run([
                "openssl", "aes-256-cbc", "-d", "-pbkdf2", "-iter", "100000", "-k", str(self.password), "-in", encrypted_file
            ], capture_output=True, text=False, check=True)
            raw = result.stdout
            if isinstance(raw, bytes):
                try:
                    return raw.decode('utf-8')
                except UnicodeDecodeError:
                    return raw.decode('utf-8', errors='replace')
            return raw
        except subprocess.CalledProcessError:
            return None

    def encrypt(self, plain_text, output_file):
        """Encrypts plain text and saves to output_file."""
        try:
            data = plain_text.encode('utf-8') if isinstance(plain_text, str) else plain_text

            # Ensure directory exists
            out_dir = os.path.dirname(output_file)
            if out_dir and not os.path.exists(out_dir):
                os.makedirs(out_dir, exist_ok=True)

            # Try in-process encryption with libcrypto if available
            if self._lib is not None:
                try:
                    enc = self._encrypt_bytes_with_lib(data)
                    with open(output_file, 'wb') as f:
                        f.write(enc)
                    try:
                        os.chmod(output_file, 0o600)
                    except (OSError, PermissionError):
                        pass
                    return True
                except (RuntimeError, OSError, IOError, ValueError):
                    pass

            # Fallback: use OpenSSL CLI
            if not self.password:
                raise ValueError("Encryption password is not set.")
            process = subprocess.Popen([
                OPENSSL_CMD, "aes-256-cbc", "-e", "-pbkdf2", "-iter", "100000", "-k", str(self.password), "-in", "-", "-out", output_file
            ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)
            stdout, stderr = process.communicate(input=data)

            if process.returncode != 0:
                err_msg = stderr.decode('utf-8', errors='replace') if isinstance(stderr, (bytes, bytearray)) else str(stderr)
                raise RuntimeError(f"Encryption failed: {err_msg}")

            try:
                os.chmod(output_file, 0o600)
            except (OSError, PermissionError):
                pass
            return True
        except (OSError, IOError, ValueError, RuntimeError) as e:
            print(f"Encryption error: {e}")
            return False

    # --- In-process AES helpers using libcrypto ---
    def _derive_key_iv(self, password: str, salt: bytes, iterations: int = ENCRYPTION_ITERATIONS):
        # Derive 48 bytes: 32 for key, 16 for IV
        if password is None or password == "":
            raise RuntimeError("Password is required for key derivation.")
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations, dklen=48)
        return dk[:32], dk[32:48]

    def _encrypt_bytes_with_lib(self, data: bytes) -> bytes:
        # Format: b'PBKDF2v1' + salt(16) + iter(4 BE) + ciphertext
        salt = secrets.token_bytes(PASSWORD_SALT_BYTES)
        iterations = ENCRYPTION_ITERATIONS
        key, iv = self._derive_key_iv(self.password, salt, iterations)

        lib = self._lib
        if lib is None:
            raise RuntimeError("libcrypto is not available")
        # Prepare OpenSSL EVP interfaces
        EVP_CIPHER_CTX_new = lib.EVP_CIPHER_CTX_new
        EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
        EVP_CIPHER_CTX_free = lib.EVP_CIPHER_CTX_free
        EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]
        EVP_aes_256_cbc = lib.EVP_aes_256_cbc
        EVP_aes_256_cbc.restype = ctypes.c_void_p
        EVP_EncryptInit_ex = lib.EVP_EncryptInit_ex
        EVP_EncryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        EVP_EncryptUpdate = lib.EVP_EncryptUpdate
        # (ctx, out, outlen, in, inlen)
        EVP_EncryptUpdate.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.c_void_p, ctypes.c_int]
        EVP_EncryptFinal_ex = lib.EVP_EncryptFinal_ex
        # (ctx, out, outlen)
        EVP_EncryptFinal_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]

        ctx = EVP_CIPHER_CTX_new()
        if not ctx:
            raise RuntimeError("Could not create EVP_CIPHER_CTX")

        try:
            # Init
            key_buf = ctypes.create_string_buffer(key, len(key))
            iv_buf = ctypes.create_string_buffer(iv, len(iv))
            res = EVP_EncryptInit_ex(ctx, EVP_aes_256_cbc(), None, ctypes.cast(key_buf, ctypes.c_void_p), ctypes.cast(iv_buf, ctypes.c_void_p))
            if res != 1:
                raise RuntimeError("EncryptInit failed")

            outlen = ctypes.c_int(0)
            # allocate output buffer: len + block_size
            outbuf = ctypes.create_string_buffer(len(data) + 16)
            data_buf = ctypes.create_string_buffer(data)
            # pass pointers to buffers, not c_char_p strings
            res = EVP_EncryptUpdate(ctx, ctypes.byref(outbuf), ctypes.byref(outlen), ctypes.byref(data_buf), len(data))
            if res != 1:
                raise RuntimeError("EncryptUpdate failed")
            total = outlen.value

            outlen2 = ctypes.c_int(0)
            res = EVP_EncryptFinal_ex(ctx, ctypes.byref(outbuf, total), ctypes.byref(outlen2))
            if res != 1:
                raise RuntimeError("EncryptFinal failed")
            total += outlen2.value

            ciphertext = outbuf.raw[:total]
            header = b'PBKDF2v1' + salt + struct.pack('>I', iterations)
            return header + ciphertext
        finally:
            EVP_CIPHER_CTX_free(ctx)

    def _decrypt_bytes_with_lib(self, enc: bytes) -> bytes | None:
        # Expect header: b'PBKDF2v1' + salt(16) + iter(4)
        if len(enc) < 8 + 16 + 4:
            return None
        if not enc.startswith(b'PBKDF2v1'):
            return None
        salt = enc[8:24]
        iterations = struct.unpack('>I', enc[24:28])[0]
        ciphertext = enc[28:]

        key, iv = self._derive_key_iv(self.password, salt, iterations)

        lib = self._lib
        if lib is None:
            return None
        EVP_CIPHER_CTX_new = lib.EVP_CIPHER_CTX_new
        EVP_CIPHER_CTX_new.restype = ctypes.c_void_p
        EVP_CIPHER_CTX_free = lib.EVP_CIPHER_CTX_free
        EVP_CIPHER_CTX_free.argtypes = [ctypes.c_void_p]
        EVP_aes_256_cbc = lib.EVP_aes_256_cbc
        EVP_aes_256_cbc.restype = ctypes.c_void_p
        EVP_DecryptInit_ex = lib.EVP_DecryptInit_ex
        EVP_DecryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        EVP_DecryptUpdate = lib.EVP_DecryptUpdate
        # (ctx, out, outlen, in, inlen)
        EVP_DecryptUpdate.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int), ctypes.c_void_p, ctypes.c_int]
        EVP_DecryptFinal_ex = lib.EVP_DecryptFinal_ex
        # (ctx, out, outlen)
        EVP_DecryptFinal_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]

        ctx = EVP_CIPHER_CTX_new()
        if not ctx:
            return None
        try:
            key_buf = ctypes.create_string_buffer(key, len(key))
            iv_buf = ctypes.create_string_buffer(iv, len(iv))
            res = EVP_DecryptInit_ex(ctx, EVP_aes_256_cbc(), None, ctypes.cast(key_buf, ctypes.c_void_p), ctypes.cast(iv_buf, ctypes.c_void_p))
            if res != 1:
                return None

            outbuf = ctypes.create_string_buffer(len(ciphertext) + 16)
            outlen = ctypes.c_int(0)
            data_buf = ctypes.create_string_buffer(ciphertext)
            # pass pointers to buffers, not c_char_p strings
            res = EVP_DecryptUpdate(ctx, ctypes.byref(outbuf), ctypes.byref(outlen), ctypes.byref(data_buf), len(ciphertext))
            if res != 1:
                return None
            total = outlen.value

            outlen2 = ctypes.c_int(0)
            res = EVP_DecryptFinal_ex(ctx, ctypes.byref(outbuf, total), ctypes.byref(outlen2))
            if res != 1:
                return None
            total += outlen2.value

            return outbuf.raw[:total]
        finally:
            EVP_CIPHER_CTX_free(ctx)


def _migrate_codes_in_place(people_data: Any, code_maps: Dict[str, List[Tuple[str, str]]] | None = None) -> None:
    if not isinstance(people_data, list):
        return
    maps = code_maps or CODE_MAPS

    def norm(s: str) -> str:
        return ''.join(ch for ch in (s or '').lower() if ch.isalnum())

    def canonicalize(field: str, val: str) -> str:
        t = (val or '').strip()
        n = norm(t)
        if field in ("CORI Status", "NH GC Status", "ME GC Status"):
            if 'req' in n:
                return 'Required'
            if 'sub' in n and field == 'CORI Status':
                return 'Submitted'
            if 'clear' in n or 'clr' in n:
                return 'Cleared'
            if field == 'ME GC Status' and ('senttodenise' in n or ('sent' in n and 'denise' in n)):
                return 'Sent to Denise'
            if 'none' in n or t == '':
                return 'None'
            return t
        if field == 'Deposit Account Type':
            if 'saving' in n:
                return 'Savings'
            if 'check' in n:
                return 'Checking'
            return '' if t == '' else t
        if field == 'Shirt Size':
            for disp, _ in maps.get('Shirt Size', []):
                if norm(disp) == n:
                    return disp
            return t or 'MD'
        return t

    def code_from_display(field: str, display: str) -> str:
        for disp, c in maps.get(field, []):
            if (display or '').strip().lower() == disp.lower():
                return c
        return ''

    def display_from_code(field: str, code: str) -> Optional[str]:
        for disp, c in maps.get(field, []):
            if (code or '').strip().upper() == c.upper():
                return disp
        return None

    for person in people_data:
        if not isinstance(person, dict):
            continue
        for field in STATUS_FIELDS:
            code_key = f"{field}_Code"
            disp = person.get(field, '')
            code = person.get(code_key, '')
            if code:
                disp_from_code = display_from_code(field, code)
                if disp_from_code:
                    person[field] = disp_from_code
            else:
                canon = canonicalize(field, disp)
                person[field] = canon
                person[code_key] = code_from_display(field, canon)



# ============================================================================
# UI HELPER FUNCTIONS
# ============================================================================

@lru_cache(maxsize=256)
def _is_dark_color(h):
    """Check if a hex color is dark."""
    try:
        h = (h or '').strip().lstrip('#')
        if len(h) == 6:
            r, g, b = tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
            lum = (0.299*r + 0.587*g + 0.114*b) / 255.0
            return lum < 0.5
    except (ValueError, TypeError):
        pass
    return True


def _normalize_text(value: Optional[str]) -> str:
    """Normalize free-text for case-insensitive comparisons."""
    try:
        return (value or "").strip().lower()
    except (AttributeError, TypeError):
        return ""


def make_action_button(parent, text, command, role="default", font=None, width=None, compact=False):
    """Create a consistently styled action button."""
    bg, active = BUTTON_ROLE_COLORS.get(role, BUTTON_ROLE_COLORS["default"]) 
    if role in ALWAYS_BLACK_TEXT_ROLES:
        fg_color = "black"
    else:
        fg_color = "white" if _is_dark_color(bg) else "black"
    if font is None:
        font = FONTS["button"]
    btn = tk.Button(
        parent, text=text, command=command, bg=bg, fg=fg_color,
        activebackground=active, activeforeground=fg_color, font=font,
        relief=tk.FLAT, bd=0, highlightthickness=1,
        highlightbackground=BUTTON_OUTLINE_COLOR,
        highlightcolor=BUTTON_OUTLINE_COLOR, cursor="hand2"
    )
    try:
        btn._role = role
    except AttributeError:
        pass
    pad_x = BUTTON_INTERNAL_PADX
    pad_y = BUTTON_INTERNAL_PADY
    if role == "charcoal" or compact:
        pad_x = max(2, BUTTON_INTERNAL_PADX // 2)
        pad_y = max(1, BUTTON_INTERNAL_PADY // 2)
    btn.config(padx=pad_x, pady=pad_y)
    if width is not None:
        btn.config(width=width)
    return btn


def pack_action_button(parent, text, command, role="default", font=None, width=None, compact=False, **pack_opts):
    """Create and pack a styled action button."""
    btn = make_action_button(parent, text, command, role=role, font=font, width=width, compact=compact)
    pack_args = {"side": tk.LEFT, "padx": 3, "ipady": BUTTON_PACK_IPADY}
    pack_args.update(pack_opts)
    btn.pack(**pack_args)
    return btn


def _safe_parent(parent):
    try:
        if parent is None:
            return None
        if hasattr(parent, "winfo_exists") and not parent.winfo_exists():
            return None
        return parent
    except (tk.TclError, AttributeError):
        return None


def safe_ui_call(widget, func, *args, **kwargs):
    """Safely schedule a UI callback if the widget still exists."""
    try:
        if widget is None:
            return
        if hasattr(widget, "winfo_exists") and not widget.winfo_exists():
            return
        widget.after(1, lambda: func(*args, **kwargs))
    except (tk.TclError, AttributeError, RuntimeError) as e:
        logger.exception("safe_ui_call failed: %s", e)


def _show_message(kind: str, parent, title, message) -> None:
    try:
        parent = _safe_parent(parent)
        fn = getattr(messagebox, f"show{kind}")
        (fn(title, message, parent=parent) if parent is not None else fn(title, message))
    except (tk.TclError, AttributeError, RuntimeError) as e:
        logger.exception("show_%s failed: %s", kind, e)


show_error = lambda parent, title, message: _show_message("error", parent, title, message)
show_info = lambda parent, title, message: _show_message("info", parent, title, message)
show_warning = lambda parent, title, message: _show_message("warning", parent, title, message)


def ask_yes_no(parent, title, message):
    """Ask yes/no question dialog."""
    try:
        parent = _safe_parent(parent)
        return messagebox.askyesno(title, message, parent=parent) if parent is not None else messagebox.askyesno(title, message)
    except (tk.TclError, AttributeError, RuntimeError) as e:
        logger.exception("ask_yes_no failed: %s", e)
        return False


def load_theme_pref(pref_path: str, default: str = "light") -> str:
    """Load theme preference from a json file (1=light, 2=dark)."""
    try:
        if os.path.exists(pref_path):
            with open(pref_path, 'r', encoding='utf-8') as f:
                val = json.load(f)
            num = val.get('theme') if isinstance(val, dict) else int(val) if isinstance(val, (int, str)) else None
            return 'dark' if num == 2 else 'light'
    except (OSError, IOError, ValueError, json.JSONDecodeError):
        pass
    return default


def save_theme_pref(pref_path: str, theme: str) -> None:
    """Persist theme preference to a json file (1=light, 2=dark)."""
    try:
        with open(pref_path, 'w', encoding='utf-8') as f:
            json.dump({"theme": 2 if theme == 'dark' else 1}, f)
    except (OSError, IOError, TypeError, ValueError):
        pass



def make_card_styles(card_bg_color: str, accent_color: str):
    """Return card styles for labels and values."""
    dark_bg = _is_dark_color(card_bg_color)
    lbl_fg = "#cfd8dc" if dark_bg else "#1a3a5a"
    val_fg = "#ecf0f1" if dark_bg else "black"
    return {
        "lbl": {"bg": card_bg_color, "fg": lbl_fg, "font": FONTS["tiny"]},
        "val": {"bg": card_bg_color, "fg": val_fg, "font": (FONTS["tiny"][0], FONTS["tiny"][1], "bold")},
        "accent_lbl": {"bg": card_bg_color, "fg": accent_color, "font": FONTS["subheader"]},
        "accent_small": {"bg": card_bg_color, "fg": lbl_fg, "font": FONTS["small"]},
    }


def apply_chrome_tokens(refs):
    """Update fonts and colors for chrome elements."""
    try:
        lbl = refs.get('title_label')
        if lbl:
            lbl.config(font=FONTS['title'])
    except (AttributeError, tk.TclError):
        pass
    # Update buttons
    for frame_key in ['title_frame', 'title_stack']:
        try:
            frame = refs.get(frame_key)
            if frame:
                for child in frame.winfo_children():
                    if isinstance(child, tk.Button):
                        role = getattr(child, '_role', 'default')
                        bg, active = BUTTON_ROLE_COLORS.get(role, BUTTON_ROLE_COLORS['default'])
                        fg = 'black' if role in ALWAYS_BLACK_TEXT_ROLES else ('white' if _is_dark_color(bg) else 'black')
                        child.config(bg=bg, activebackground=active, fg=fg, activeforeground=fg, font=FONTS['button'])
        except Exception:
            pass


def get_palette(theme):
    """Return color palette for theme."""
    if theme == 'dark':
        return DARK_PALETTE.copy()
    return LIGHT_PALETTE.copy()


def apply_palette(root, palette, refs):
    """Apply color palette to UI elements."""
    try:
        root.configure(bg=palette.get("bg_color"))
        CURRENT_PALETTE.update(palette)
    except (AttributeError, tk.TclError):
        pass


def build_search_bar(parent, search_var, on_search, width=None):
    """Create search bar with entry and button."""
    if width is None:
        width = WIDGET_WIDTHS['search_entry']
    try:
        bg = parent.cget("bg")
    except:
        bg = CURRENT_PALETTE.get("bg_color")
    frame = tk.Frame(parent, bg=bg)
    frame.pack(side=tk.RIGHT, padx=PADDING_H['medium'])
    entry_bg = CURRENT_PALETTE.get('card_bg_color', '#ffffff')
    entry_fg = CURRENT_PALETTE.get('fg_color', '#2c3e50')
    entry = tk.Entry(
        frame,
        textvariable=search_var,
        font=FONTS["small"],
        width=width,
        bg=entry_bg,
        fg=entry_fg,
        insertbackground=entry_fg,
    )
    entry.pack(side=tk.LEFT, padx=(0, 6), pady=6)
    entry.bind("<Return>", lambda e: on_search())
    btn = make_action_button(frame, "Search", on_search, role="charcoal", font=FONTS["button"])
    btn.pack(side=tk.LEFT)
    return entry, frame


def create_kv_row(parent, label_text, value_text, lbl_style, val_style, bg=None):
    """Create label:value row."""
    row = tk.Frame(parent, bg=bg or lbl_style.get("bg"))
    row.pack(anchor="w", fill="x", pady=1)
    tk.Label(row, text=f"{label_text}:", **lbl_style).pack(side=tk.LEFT)
    tk.Label(row, text=value_text, **val_style).pack(side=tk.LEFT, padx=(4, 0))
    return row


def add_separator(parent, color=None, pady=None):
    """Add horizontal separator line."""
    if color is None:
        color = SEPARATOR_COLOR
    if pady is None:
        pady = PADDING['default']
    sep = tk.Frame(parent, height=1, bg=color)
    sep.pack(fill=tk.X, pady=pady)
    return sep


def build_section_header(parent, text, style):
    """Create section header label."""
    return tk.Label(parent, text=text, **style)


def build_info_bar(parent, person, fields, lbl_style, val_style):
    """Render horizontal info bar."""
    info_bar = tk.Frame(parent, bg=lbl_style.get("bg"))
    info_bar.pack(fill=tk.X, padx=4, pady=PADDING['info_bar'])
    for label, key in fields:
        tk.Label(info_bar, text=f"{label}", **lbl_style).pack(side=tk.LEFT)
        tk.Label(info_bar, text=person.get(key, "N/A"), **val_style).pack(side=tk.LEFT, padx=(3, 12))
    return info_bar


def build_neo_badge(parent, neo_date):
    """Create NEO status badge."""
    neo_disp = "Not Scheduled"
    neo_bg, neo_fg = NEO_BADGE_COLORS['default']
    
    date_str = (neo_date or '').strip()
    if date_str:
        neo_disp = f"NEO: {date_str}"
        today_str = datetime.now().strftime("%m/%d/%Y")
        try:
            if date_str == today_str:
                neo_bg, neo_fg = NEO_BADGE_COLORS['today']
            else:
                neo_bg, neo_fg = NEO_BADGE_COLORS['future']
        except Exception:
            pass
    return tk.Label(parent, text=neo_disp, bg=neo_bg, fg=neo_fg, font=FONTS["tiny_bold"], padx=PADDING_H['medium'], pady=PADDING['badge'][0])


def build_uniform_row(parent, person, bg="#e2e6e9"):
    """Render compact uniform info row."""
    row = tk.Frame(parent, bg=bg, padx=5, pady=2)
    row.pack(fill=tk.X, pady=(10, 0))
    tk.Label(row, text="Uniform:", font=FONTS["tiny_bold"], bg=bg).pack(side=tk.LEFT)
    u_txt = f"S:{person.get('Shirt Size','-')} P:{person.get('Pants Size','-')} B:{person.get('Boots Size','-')}"
    tk.Label(row, text=u_txt, font=FONTS["tiny"], bg=bg).pack(side=tk.LEFT, padx=5)
    issued = bool(person.get("Uniform Issued"))
    status = UNIFORM_STATUS_ISSUED if issued else UNIFORM_STATUS_NOT_ISSUED
    u_fg = UNIFORM_STATUS_ISSUED_COLOR if issued else UNIFORM_STATUS_NOT_ISSUED_COLOR
    tk.Label(row, text=status, font=FONTS["tiny_bold"], bg=bg, fg=u_fg).pack(side=tk.RIGHT)
    return row


def apply_text_contrast(container):
    """Apply readable foreground colors to labels."""
    try:
        try:
            bg = container.cget('bg')
        except:
            bg = '#e2e6e9'
        is_dark = _is_dark_color(bg)
        fg = '#ecf0f1' if is_dark else '#2c3e50'
        for child in container.winfo_children():
            try:
                if isinstance(child, (tk.Label, tk.Checkbutton, tk.Radiobutton)):
                    child.config(fg=fg)
                if isinstance(child, (tk.Frame, tk.LabelFrame)):
                    apply_text_contrast(child)
            except:
                pass
    except:
        pass


def apply_button_roles(container):
    """Recursively restyle buttons based on roles."""
    try:
        for child in container.winfo_children():
            try:
                if isinstance(child, tk.Button):
                    role = getattr(child, '_role', 'default')
                    bg, active = BUTTON_ROLE_COLORS.get(role, BUTTON_ROLE_COLORS['default'])
                    fg = 'black' if role in ALWAYS_BLACK_TEXT_ROLES else ('white' if _is_dark_color(bg) else 'black')
                    child.config(bg=bg, fg=fg, activebackground=active, activeforeground=fg)
                if isinstance(child, (tk.Frame, tk.LabelFrame)):
                    apply_button_roles(child)
            except:
                pass
    except:
        pass


def fix_checkbox_contrast(container, use_bg=None):
    """Ensure checkboxes have visible indicator colors."""
    try:
        try:
            bg = use_bg if use_bg is not None else container.cget('bg')
        except:
            bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
        sel = CURRENT_PALETTE.get('checkbox_select_color', '#ffffff' if _is_dark_color(bg) else '#000000')
        for child in container.winfo_children():
            try:
                if isinstance(child, (tk.Checkbutton, tk.Radiobutton)):
                    child.config(selectcolor=sel, activebackground=bg)
                if isinstance(child, (tk.Frame, tk.LabelFrame)):
                    fix_checkbox_contrast(child, use_bg=bg)
            except:
                pass
    except:
        pass


# ============================================================================
# DIALOG CLASSES
# ============================================================================
class BaseDialog(tk.Toplevel):
    """Base class for application dialogs with common setup."""
    
    def __init__(self, parent, title: str, width: int = 480, height: int = 200, resizable: bool = False):
        super().__init__(parent)
        self.title(title)
        self.geometry(f"{width}x{height}")
        self.resizable(resizable, resizable)
        self.result = None
        
        # Get theme colors
        self.dlg_bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
        self.dlg_fg = CURRENT_PALETTE.get('fg_color', '#2c3e50')
        self.field_bg = CURRENT_PALETTE.get('card_bg_color', '#ffffff')
        
        self.configure(bg=self.dlg_bg)
        self.protocol("WM_DELETE_WINDOW", self.on_cancel)
        self.transient(parent)
    
    def on_confirm(self):
        """Override in subclass."""
        self.destroy()
    
    def on_cancel(self):
        """Override in subclass if needed."""
        self.result = None
        self.destroy()
    
    def center_on_parent(self, parent):
        """Center this dialog on the parent window."""
        try:
            center_window(self, parent)
        except Exception:
            pass

    def _make_modal(self, parent, focus_widget=None, topmost: bool = False) -> None:
        try:
            self.center_on_parent(parent)
        except Exception:
            pass
        try:
            self.deiconify()
            self.wait_visibility()
        except Exception:
            pass
        try:
            self.grab_set()
        except Exception:
            pass
        if topmost:
            try:
                self.attributes("-topmost", True)
            except Exception:
                pass
        if focus_widget is not None:
            try:
                focus_widget.focus_set()
            except Exception:
                pass

    def _build_confirm_cancel_bar(
        self,
        parent,
        confirm_text: str = "Confirm",
        cancel_text: str = "Cancel",
        confirm_cmd=None,
        cancel_cmd=None,
        width: int = BUTTON_WIDTHS['dialog_button'],
        padx: int = 8,
        bind_return: bool = True,
        bind_escape: bool = True,
        bind_kp_enter: bool = False,
    ):
        btn_frame = tk.Frame(parent, bg=self.dlg_bg)
        btn_frame.pack(pady=10, fill="x")

        confirm_cmd = confirm_cmd or self.on_confirm
        cancel_cmd = cancel_cmd or self.on_cancel

        btn_confirm = make_action_button(
            btn_frame,
            confirm_text,
            confirm_cmd,
            role="confirm",
            font=FONTS["button"],
            width=width,
        )
        btn_confirm.pack(side=tk.LEFT, padx=padx)

        spacer = tk.Frame(btn_frame, bg=self.dlg_bg)
        spacer.pack(side=tk.LEFT, expand=True, fill="x")

        btn_cancel = make_action_button(
            btn_frame,
            cancel_text,
            cancel_cmd,
            role="cancel",
            font=FONTS["button"],
            width=width,
        )
        btn_cancel.pack(side=tk.RIGHT, padx=padx)

        if bind_return:
            self.bind("<Return>", lambda e: btn_confirm.invoke())
        if bind_kp_enter:
            self.bind("<KP_Enter>", lambda e: btn_confirm.invoke())
        if bind_escape:
            self.bind("<Escape>", lambda e: btn_cancel.invoke())

        return btn_frame, btn_confirm, btn_cancel

    def _build_action_bar(
        self,
        parent,
        buttons,
        padx: int = 6,
        pady: int = 6,
    ):
        btn_frame = tk.Frame(parent, bg=self.dlg_bg)
        btn_frame.pack(pady=pady)

        created = []
        for text, command, role, width in buttons:
            btn = make_action_button(
                btn_frame,
                text,
                command,
                role=role,
                font=FONTS["button"],
                width=width,
            )
            btn.pack(side=tk.LEFT, padx=padx)
            created.append(btn)
        return btn_frame, created


def center_window(window: tk.Toplevel | tk.Tk, parent: Optional[tk.Misc] = None) -> None:
    """Center a window on its parent or the screen."""
    try:
        window.update_idletasks()
        w = window.winfo_width() or window.winfo_reqwidth()
        h = window.winfo_height() or window.winfo_reqheight()

        if parent is not None and parent.winfo_exists():
            px = parent.winfo_rootx()
            py = parent.winfo_rooty()
            pw = parent.winfo_width() or parent.winfo_reqwidth() or 600
            ph = parent.winfo_height() or parent.winfo_reqheight() or 400
            x = px + (pw - w) // 2
            y = py + (ph - h) // 2
        else:
            sw = window.winfo_screenwidth()
            sh = window.winfo_screenheight()
            x = (sw - w) // 2
            y = (sh - h) // 2

        window.geometry(f"{w}x{h}+{x}+{y}")
    except Exception:
        pass


class LoginDialog(BaseDialog):
    def __init__(self, parent, task="login"):
        title = "Security Check" if task == "login" else "Set Master Password"
        super().__init__(parent, title, width=520, height=260)
        self.task = task
        
        main_frame = tk.Frame(self, bg=self.dlg_bg, padx=30, pady=30)
        main_frame.pack(expand=True, fill="both")
        
        icon_lbl = tk.Label(main_frame, text="Security", font=FONTS["header"], bg=self.dlg_bg, fg=self.dlg_fg)
        icon_lbl.pack()
        
        msg = "Enter your Master Password to unlock the database:" if task=="login" else "Create a Master Password for your new database:"
        tk.Label(main_frame, text=msg, bg=self.dlg_bg, fg=self.dlg_fg, wraplength=420, font=FONTS["body"]).pack(pady=(0, 12))

        # Larger entry for easier interaction
        self.pw_entry = tk.Entry(main_frame, show="*", font=FONTS["subheader"], justify="center", bg=self.field_bg, fg=self.dlg_fg, insertbackground=self.dlg_fg)
        self.pw_entry.pack(fill="x", pady=8, ipady=6)
        self.pw_entry.focus_set()
        _, btn_confirm, _ = self._build_confirm_cancel_bar(
            main_frame,
            confirm_text="Confirm",
            cancel_text="Exit",
            padx=12,
            bind_kp_enter=True,
        )
        btn_confirm.configure(default="active")

        self.grab_set()

    def on_confirm(self):
        pw = self.pw_entry.get().strip()
        if not pw:
            show_warning(self, "Warning", "Password cannot be empty.")
            return
        self.result = pw
        self.destroy()


class ArchivePasswordDialog(BaseDialog):
    def __init__(self, parent, prompt="Enter archive password:", default=""):
        super().__init__(parent, "Archive Password", width=480, height=200)
        
        main_frame = tk.Frame(self, bg=self.dlg_bg, padx=24, pady=20)
        main_frame.pack(expand=True, fill="both")

        tk.Label(main_frame, text=prompt, bg=self.dlg_bg, fg=self.dlg_fg, font=FONTS["body"]).pack(pady=(0, 8))
        self.pw_entry = tk.Entry(main_frame, show="*", font=FONTS["subheader"], justify="center", bg=self.field_bg, fg=self.dlg_fg, insertbackground=self.dlg_fg)
        self.pw_entry.pack(fill="x", pady=8, ipady=6)
        if default:
            try:
                self.pw_entry.insert(0, default)
            except Exception:
                pass
        self._build_confirm_cancel_bar(main_frame)

        # Center and make modal
        self._make_modal(parent, focus_widget=self.pw_entry, topmost=True)

    def on_confirm(self):
        pw = self.pw_entry.get().strip()
        if not pw:
            show_warning(self, "Warning", "Password cannot be empty.")
            return
        self.result = pw
        self.destroy()


class NEOTimeDialog(BaseDialog):
    """Dialog for entering NEO start and end times."""
    def __init__(self, parent, person_name):
        super().__init__(parent, "NEO Hours", width=480, height=300)
        self.person_name = person_name
        self.start_time = None
        self.end_time = None
        
        main_frame = tk.Frame(self, bg=self.dlg_bg, padx=24, pady=20)
        main_frame.pack(expand=True, fill="both")

        tk.Label(main_frame, text=f"Enter NEO times for {person_name}", bg=self.dlg_bg, fg=self.dlg_fg, font=FONTS["subheader"]).pack(pady=(0, 12))
        
        tk.Label(main_frame, text="Start Time (e.g., 0800):", bg=self.dlg_bg, fg=self.dlg_fg, font=FONTS["body"]).pack(anchor="w", pady=(0, 4))
        self.start_entry = tk.Entry(main_frame, font=FONTS["subheader"], justify="center", bg=self.field_bg, fg=self.dlg_fg, insertbackground=self.dlg_fg)
        self.start_entry.pack(fill="x", pady=(0, 12), ipady=6)
        
        tk.Label(main_frame, text="End Time (e.g., 1700):", bg=self.dlg_bg, fg=self.dlg_fg, font=FONTS["body"]).pack(anchor="w", pady=(0, 4))
        self.end_entry = tk.Entry(main_frame, font=FONTS["subheader"], justify="center", bg=self.field_bg, fg=self.dlg_fg, insertbackground=self.dlg_fg)
        self.end_entry.pack(fill="x", pady=(0, 12), ipady=6)
        self._build_confirm_cancel_bar(main_frame)

        # Center and make modal
        self._make_modal(parent, focus_widget=self.start_entry, topmost=True)

    def on_confirm(self):
        start = self.start_entry.get().strip()
        end = self.end_entry.get().strip()
        if not start or not end:
            show_warning(self, "Warning", "Both start and end times are required.")
            return
        self.start_time = start
        self.end_time = end
        self.result = (start, end)
        self.destroy()


class ArchiveSuccessDialog(BaseDialog):
    """Compact archive success dialog with optional open-location button."""
    def __init__(self, parent, archive_path, on_open_location=None):
        super().__init__(parent, "Archived", width=460, height=200)
        self.archive_path = archive_path
        self.on_open_location = on_open_location

        main_frame = tk.Frame(self, bg=self.dlg_bg, padx=16, pady=14)
        main_frame.pack(expand=True, fill="both")

        tk.Label(
            main_frame,
            text="Archive created successfully.",
            bg=self.dlg_bg,
            fg=self.dlg_fg,
            font=FONTS["subheader"],
        ).pack(pady=(0, 8))

        tk.Label(
            main_frame,
            text=f"Location:\n{archive_path}",
            bg=self.dlg_bg,
            fg=self.dlg_fg,
            font=FONTS["small"],
            wraplength=400,
            justify="left",
        ).pack(pady=(0, 10))

        buttons = [("OK", self.on_confirm, "confirm", 12)]
        if self.on_open_location:
            buttons.append(("Open File Location", self._open_location, "view", 20))
        _, created = self._build_action_bar(main_frame, buttons)
        if created:
            self.bind("<Return>", lambda e: created[0].invoke())
            self.bind("<Escape>", lambda e: self.on_cancel())

        # Center and make modal
        self._make_modal(parent, topmost=True)

    def _open_location(self):
        try:
            self.on_open_location()
        except Exception:
            pass

    def on_confirm(self):
        self.result = True
        self.destroy()


class ExportSuccessDialog(BaseDialog):
    """Export success dialog with quick actions."""
    def __init__(self, parent, title, message, on_open_location=None, on_view_csv=None):
        super().__init__(parent, title, width=640, height=220)
        self.on_open_location = on_open_location
        self.on_view_csv = on_view_csv

        main_frame = tk.Frame(self, bg=self.dlg_bg, padx=16, pady=14)
        main_frame.pack(expand=True, fill="both")

        tk.Label(
            main_frame,
            text=message,
            bg=self.dlg_bg,
            fg=self.dlg_fg,
            font=FONTS["body"],
            justify="left",
            wraplength=520,
        ).pack(anchor="w", pady=(0, 12))
        _, created = self._build_action_bar(
            main_frame,
            [
                ("OK", self.on_cancel, "confirm", 8),
                ("Open File Location", self._open_location, "view", 18),
                ("View CSV", self._view_csv, "continue", 12),
            ],
            padx=8,
        )
        if created:
            self.bind("<Return>", lambda e: created[0].invoke())
            self.bind("<Escape>", lambda e: created[0].invoke())

        self._make_modal(parent)

    def _open_location(self):
        try:
            if callable(self.on_open_location):
                self.on_open_location()
        finally:
            self.on_cancel()

    def _view_csv(self):
        try:
            if callable(self.on_view_csv):
                self.on_view_csv()
        finally:
            self.on_cancel()


class WeeklyTrackerGUI(tk.Toplevel):
    """Weekly work tracker embedded inside the Workflow app."""
    def __init__(self, parent, data_dir: str):
        super().__init__(parent)
        self.title("Weekly Work Tracker")
        self.geometry("1400x1000")
        self.resizable(True, True)

        palette = CURRENT_PALETTE
        self.bg_color = palette.get("bg_color", "#e2e6e9")
        self.fg_color = palette.get("fg_color", "#2c3e50")
        self.accent_color = palette.get("accent_color", "#3498db")
        self.button_color = palette.get("button_color", "#27ae60")
        self.error_color = palette.get("error_color", "#e74c3c")
        self.warning_color = palette.get("warning_color", "#f39c12")
        self.card_bg_color = palette.get("card_bg_color", "#ffffff")
        self.fonts = FONTS

        self.configure(bg=self.bg_color)

        self.tracker_dir = os.path.join(data_dir, TRACKER_DIR_NAME)
        self.tracker_exports_dir = os.path.join(data_dir, EXPORTS_DIR_NAME)
        ensure_dirs(self.tracker_dir, self.tracker_exports_dir)

        self.week_start, self.week_end = self.get_current_work_week()
        self.week_file = self.get_week_filename()

        self.day_widgets = {}
        self.days = WEEKDAY_NAMES

        self.create_widgets()
        self.load_week_data()
        self._setup_keyboard_shortcuts()
        try:
            center_window(self, parent)
        except Exception:
            pass

    def _setup_keyboard_shortcuts(self) -> None:
        try:
            self.bind("<Control-s>", lambda e: self.save_week())
            self.bind("<Control-e>", lambda e: self.export_summary())
            self.bind("<Control-k>", lambda e: self.clear_week())
        except RuntimeError:
            pass

    def get_current_work_week(self):
        today = datetime.now().date()
        weekday = today.weekday()
        if weekday >= 4:
            days_since_friday = weekday - 4
            week_start = today - timedelta(days=days_since_friday)
        else:
            days_since_friday = weekday + 3
            week_start = today - timedelta(days=days_since_friday)
        week_end = week_start + timedelta(days=6)
        return week_start, week_end

    def get_week_filename(self):
        start_str = self.week_start.strftime("%Y-%m-%d")
        end_str = self.week_end.strftime("%Y-%m-%d")
        filename = f"Week_{start_str}_to_{end_str}.json"
        return os.path.join(self.tracker_dir, filename)

    def create_widgets(self):
        self._build_title()
        self._build_week_info()
        self._build_content_area()
        self._build_buttons()

    def _build_title(self) -> None:
        title_frame = tk.Frame(self, bg=self.accent_color, height=60)
        title_frame.pack(fill=tk.X, pady=(0, 10))
        title_frame.pack_propagate(False)
        title_label = tk.Label(
            title_frame,
            text="📅 Weekly Work Tracker",
            font=FONTS["title"],
            bg=self.accent_color,
            fg="white",
        )
        title_label.pack(expand=True)

    def _build_week_info(self) -> None:
        week_info_frame = tk.Frame(self, bg=self.bg_color)
        week_info_frame.pack(fill=tk.X, padx=20, pady=(0, 10))
        week_label = tk.Label(
            week_info_frame,
            text=f"Work Week: {self.week_start.strftime('%B %d, %Y')} - {self.week_end.strftime('%B %d, %Y')}",
            font=FONTS["subheader"],
            bg=self.bg_color,
            fg="#1a3a5a",
        )
        week_label.pack()

    def _build_content_area(self) -> None:
        container = tk.Frame(self, bg=self.bg_color)
        container.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        self.content_frame = tk.Frame(container, bg=self.bg_color)
        self.content_frame.pack(fill=tk.BOTH, expand=True)
        self.create_day_sections()

    def _build_buttons(self) -> None:
        button_frame = tk.Frame(self, bg=self.bg_color)
        button_frame.pack(fill=tk.X, padx=20, pady=20)
        save_btn = make_action_button(
            button_frame,
            "Save Week",
            self.save_week,
            role="save",
            font=FONTS["button"],
            width=16,
        )
        save_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 5))
        export_btn = make_action_button(
            button_frame,
            "📤 Export Summary",
            self.export_summary,
            role="view",
            font=FONTS["button"],
            width=18,
        )
        export_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(5, 5))
        clear_btn = make_action_button(
            button_frame,
            "🗑️ Clear Week",
            self.clear_week,
            role="delete",
            font=FONTS["button"],
            width=16,
        )
        clear_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(5, 0))

    def create_day_sections(self):
        self.content_frame.columnconfigure(0, weight=1)
        self.content_frame.columnconfigure(1, weight=1)

        for i, day_name in enumerate(self.days):
            row = i // 2
            col = i % 2
            is_last_day = (i == len(self.days) - 1)
            day_date = self.week_start + timedelta(days=i)
            date_str = day_date.strftime("%B %d, %Y")
            today = datetime.now().date()
            is_past = day_date <= today
            is_today = day_date == today

            section_frame = tk.Frame(self.content_frame, bg=self.bg_color)
            if is_last_day:
                section_frame.grid(row=row, column=0, columnspan=2, sticky="nsew", padx=10, pady=5)
            else:
                section_frame.grid(row=row, column=col, sticky="nsew", padx=10, pady=5)
            self.content_frame.rowconfigure(row, weight=1)
            section_frame.columnconfigure(0, weight=1)

            if is_today:
                indicator_color = self.button_color
                day_label_text = f"📍 {day_name} - {date_str} (TODAY)"
            elif is_past:
                indicator_color = self.accent_color
                day_label_text = f"{day_name} - {date_str}"
            else:
                indicator_color = "#7f8c8d"
                day_label_text = f"{day_name} - {date_str} (upcoming)"

            header_frame = tk.Frame(section_frame, bg=self.bg_color)
            header_frame.pack(fill=tk.X, pady=(0, 5))
            day_label = tk.Label(
                header_frame,
                text=day_label_text,
                font=FONTS["subtext_bold"],
                bg=self.bg_color,
                fg=indicator_color if not is_today else "#1a3a5a",
                anchor="w",
            )
            day_label.pack(side=tk.LEFT)

            time_frame = tk.Frame(header_frame, bg=self.bg_color)
            time_frame.pack(side=tk.RIGHT)
            tk.Label(time_frame, text="Start:", bg=self.bg_color, fg="#1a3a5a", font=FONTS["tiny"]).pack(side=tk.LEFT)
            start_entry = tk.Entry(time_frame, width=8, font=FONTS["tiny"], relief=tk.FLAT, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
            start_entry.pack(side=tk.LEFT, padx=(2, 10))
            tk.Label(time_frame, text="End:", bg=self.bg_color, fg="#1a3a5a", font=FONTS["tiny"]).pack(side=tk.LEFT)
            end_entry = tk.Entry(time_frame, width=8, font=FONTS["tiny"], relief=tk.FLAT, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
            end_entry.pack(side=tk.LEFT, padx=(2, 0))

            separator = tk.Frame(section_frame, height=2, bg=indicator_color)
            separator.pack(fill=tk.X, pady=(0, 8))

            text_widget = scrolledtext.ScrolledText(
                section_frame,
                height=5,
                font=FONTS["body"],
                bg=self.card_bg_color,
                fg=self.fg_color,
                insertbackground=self.fg_color,
                relief=tk.FLAT,
                wrap=tk.WORD,
                padx=15,
                pady=10,
            )
            text_widget.pack(fill=tk.BOTH, expand=True)

            self.day_widgets[day_name] = {
                "widget": text_widget,
                "start_entry": start_entry,
                "end_entry": end_entry,
                "date": day_date,
                "date_str": date_str,
            }

    def load_week_data(self):
        if os.path.exists(self.week_file):
            try:
                with open(self.week_file, "r", encoding="utf-8") as f:
                    data = json.load(f)

                entries = data.get("entries") if isinstance(data, dict) else None
                if not entries and isinstance(data, dict):
                    entries = data

                for day_name, content_data in (entries or {}).items():
                    if day_name in self.day_widgets:
                        day_info = self.day_widgets[day_name]
                        if isinstance(content_data, dict):
                            content = content_data.get("content", "")
                            start = content_data.get("start", "")
                            end = content_data.get("end", "")
                        else:
                            content = content_data
                            start = ""
                            end = ""

                        day_info["widget"].delete("1.0", tk.END)
                        if content != NO_ENTRIES_TEXT:
                            day_info["widget"].insert("1.0", content)

                        day_info["start_entry"].delete(0, tk.END)
                        day_info["start_entry"].insert(0, start)

                        day_info["end_entry"].delete(0, tk.END)
                        day_info["end_entry"].insert(0, end)

            except (OSError, json.JSONDecodeError) as e:
                show_error(self, "Load Error", f"Could not load week data:\n{str(e)}")

    def save_week(self):
        try:
            data = self.generate_week_data()
            with open(self.week_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            show_info(self, "Saved!", f"Week tracker saved to:\n{self.week_file}")
        except OSError as e:
            show_error(self, "Save Error", f"Could not save week data:\n{str(e)}")

    def generate_week_data(self):
        data = {
            "metadata": {
                "week_start": self.week_start.strftime("%Y-%m-%d"),
                "week_end": self.week_end.strftime("%Y-%m-%d"),
                "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            },
            "entries": {},
        }

        for day_name in self.days:
            day_info = self.day_widgets[day_name]
            day_content = day_info["widget"].get("1.0", tk.END).strip()
            day_start = day_info["start_entry"].get().strip()
            day_end = day_info["end_entry"].get().strip()
            data["entries"][day_name] = {
                "content": day_content if day_content else NO_ENTRIES_TEXT,
                "start": day_start,
                "end": day_end,
            }
        return data

    def _parse_time_to_minutes(self, time_str: str):
        if not time_str:
            return None
        t = time_str.replace(":", "").replace(" ", "").strip()
        if not t:
            return None
        if not t.isdigit():
            return None
        if len(t) == 1:
            t = f"0{t}00"
        elif len(t) == 2:
            t = f"{t}00"
        elif len(t) == 3:
            t = f"0{t}"
        if len(t) != 4:
            return None
        try:
            hours = int(t[:2])
            minutes = int(t[2:])
        except ValueError:
            return None
        if hours > 23 or minutes > 59:
            return None
        return hours * 60 + minutes

    def calculate_day_hours(self, start_str, end_str):
        if not start_str or not end_str:
            return 0.0
        start_mins = self._parse_time_to_minutes(start_str)
        end_mins = self._parse_time_to_minutes(end_str)
        if start_mins is None or end_mins is None:
            return 0.0
        diff = end_mins - start_mins
        if diff < 0:
            diff += 24 * 60
        hours = diff / 60.0
        return round(hours * 2) / 2

    def export_summary(self):
        try:
            data = self.generate_week_data()
            entries = data.get("entries", {})
            total_week_hours = 0.0

            lines = []
            lines.append("=" * 60)
            lines.append("WEEKLY WORK TRACKER SUMMARY")
            lines.append(f"Work Week: {self.week_start.strftime('%B %d, %Y')} - {self.week_end.strftime('%B %d, %Y')}")
            lines.append(f"Generated: {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
            lines.append("=" * 60)
            lines.append("")

            day_details = []
            for day_name in self.days:
                day_data = entries.get(day_name, {})
                content = day_data.get("content", "")
                start = day_data.get("start", "")
                end = day_data.get("end", "")

                day_hours = self.calculate_day_hours(start, end)
                total_week_hours += day_hours

                day_details.append(f"--- {day_name} ---")
                if start and end:
                    day_details.append(f"Time: {start} to {end} ({day_hours} hours)")
                else:
                    day_details.append("Time: (Not specified)")

                day_details.append("Activities:")
                if content and content != NO_ENTRIES_TEXT:
                    day_details.append(content)
                else:
                    day_details.append(NO_ACTIVITIES_TEXT)
                day_details.append("")

            lines.append(f"TOTAL WEEKLY HOURS: {total_week_hours}")
            lines.append("-" * 60)
            lines.append("")
            lines.extend(day_details)

            content_str = "\n".join(lines)
            filename = os.path.basename(self.week_file).replace(".json", "_SUMMARY.txt")
            summary_file = os.path.join(self.tracker_exports_dir, filename)

            with open(summary_file, "w", encoding="utf-8") as f:
                f.write(content_str)

            show_info(self, "Exported!", f"Summary exported to:\n{summary_file}")

        except OSError as e:
            show_error(self, "Export Error", f"Could not export summary:\n{str(e)}")

    def clear_week(self):
        result = ask_yes_no(self, "Clear Week?", "Are you sure you want to clear all entries for this week?\n\nThis cannot be undone!")
        if result:
            for day_info in self.day_widgets.values():
                day_info["widget"].delete("1.0", tk.END)
            show_info(self, "Cleared", "All entries have been cleared.")

class ArchiveViewer(tk.Toplevel):
    """Simplified archive viewer using basic ZIP password protection."""
    def __init__(self, parent, archive_dir, owner_gui=None):
        import zipfile  # Lazy import
        super().__init__(parent)
        self.title("Archive Browser")
        self.geometry("900x650")
        self.archive_dir = archive_dir
        # Reference to the owning WorkflowGUI (optional) so we can reuse its spinner helpers
        self.owner_gui = owner_gui
        # Use active theme palette
        self.bg_color = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
        self.fg_color = CURRENT_PALETTE.get('fg_color', '#2c3e50')
        self.card_bg_color = CURRENT_PALETTE.get('card_bg_color', '#ffffff')
        self.configure(bg=self.bg_color)
        
        # Main Layout
        self.paned = tk.PanedWindow(self, orient=tk.HORIZONTAL, bg=self.bg_color, sashwidth=4)
        self.paned.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)
        
        # Left Panel: Treeview
        left_frame = tk.Frame(self.paned, bg=self.bg_color)
        self.paned.add(left_frame, width=300)
        
        tk.Label(left_frame, text="Archives", font=FONTS["subtext_bold"], bg=self.bg_color, fg=self.fg_color).pack(fill=tk.X)
        
        self.tree = ttk.Treeview(left_frame, show="tree")
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        scrollbar = ttk.Scrollbar(left_frame, orient=tk.VERTICAL, command=self.tree.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree.configure(yscrollcommand=scrollbar.set)
        
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        
        # Right Panel: Text Viewer
        right_frame = tk.Frame(self.paned, bg=self.bg_color)
        self.paned.add(right_frame)
        
        self.title_lbl = tk.Label(right_frame, text="Archive Details", font=FONTS["subtext_bold"], bg=self.bg_color, fg=self.fg_color, anchor="w", padx=10)
        self.title_lbl.pack(fill=tk.X)
        
        self.text_view = tk.Text(right_frame, font=FONTS["mono"], state=tk.DISABLED, undo=False, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        self.text_view.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        text_scroll = ttk.Scrollbar(right_frame, orient=tk.VERTICAL, command=self.text_view.yview)
        text_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.text_view.configure(yscrollcommand=text_scroll.set)
        
        # Bottom action bar
        btn_bar = tk.Frame(self, bg=self.bg_color)
        btn_bar.pack(fill=tk.X, padx=10, pady=(0, 10))
        try:
            pack_action_button(
                btn_bar,
                "Open File Location",
                self._open_archive_location,
                role="view",
                font=FONTS["button"],
                width=20,
                side=tk.LEFT,
                padx=6,
            )
        except Exception as e:
            logger.exception("ArchiveViewer: failed to add Open File Location button: %s", e)
        try:
            pack_action_button(
                btn_bar,
                "Encrypt Selected Zip File",
                self._encrypt_selected_archive,
                role="save",
                font=FONTS["button"],
                width=24,
                side=tk.LEFT,
                padx=6,
            )
        except Exception as e:
            logger.exception("ArchiveViewer: failed to add Encrypt button: %s", e)
        try:
            pack_action_button(
                btn_bar,
                "Change Zip Password",
                self._change_zip_password,
                role="continue",
                font=FONTS["button"],
                width=22,
                side=tk.LEFT,
                padx=6,
            )
        except Exception as e:
            logger.exception("ArchiveViewer: failed to add Change Password button: %s", e)
        spacer = tk.Frame(btn_bar, bg=self.bg_color)
        spacer.pack(side=tk.LEFT, expand=True, fill=tk.X)
        pack_action_button(btn_bar, "Close", self.destroy, role="cancel", font=FONTS["button"], width=12, side=tk.RIGHT, padx=6)

        self.load_archive_list()
        try:
            center_window(self, self.master)
        except Exception as e:
            logger.exception("ArchiveViewer: failed to center window: %s", e)

    def _open_archive_location(self):
        """Open the archives folder in the system file manager."""
        ensure_dirs(self.archive_dir)
        try:
            path = os.path.abspath(self.archive_dir)
            if sys.platform.startswith('linux'):
                subprocess.Popen(['xdg-open', path])
            elif sys.platform.startswith('darwin'):
                subprocess.Popen(['open', path])
            elif sys.platform.startswith('win'):
                subprocess.Popen(['explorer', path])
            else:
                raise Exception('Unsupported platform for auto-open')
        except Exception:
            show_info(self, 'Open Location', f'Open this folder manually:\n{self.archive_dir}')

    # Fallback spinner helpers for ArchiveViewer (prefer owner_gui if provided)
    def _show_spinner(self, parent, message: str = 'Loading...'):
        try:
            if getattr(self, 'owner_gui', None) and hasattr(self.owner_gui, '_show_spinner'):
                return self.owner_gui._show_spinner(parent, message)
        except Exception as e:
            logger.exception("ArchiveViewer: owner spinner failed: %s", e)
        try:
            win = tk.Toplevel(parent)
            win.transient(parent)
            win.overrideredirect(True)
            win.attributes('-topmost', True)
            try:
                parent.update_idletasks()
                px = parent.winfo_rootx()
                py = parent.winfo_rooty()
                pw = parent.winfo_width()
                ph = parent.winfo_height()
                ww = 260
                wh = 80
                x = px + max(0, (pw - ww) // 2)
                y = py + max(0, (ph - wh) // 2)
                win.geometry(f"{ww}x{wh}+{x}+{y}")
            except Exception as e:
                logger.exception("ArchiveViewer: spinner positioning failed: %s", e)
            frm = tk.Frame(win, bg='#ffffff', bd=1, relief=tk.RIDGE)
            frm.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)
            lbl = tk.Label(frm, text=message, font=FONTS['small_bold'], bg='#ffffff')
            lbl.pack(side=tk.TOP, pady=(8, 4))
            try:
                pb = ttk.Progressbar(frm, mode='indeterminate', length=200)
                pb.pack(side=tk.TOP, pady=(0, 8))
                pb.start(10)
            except Exception:
                pb = None
            return win
        except Exception as e:
            logger.exception("ArchiveViewer: failed to show spinner: %s", e)
            return None

    def _hide_spinner(self, spinner) -> None:
        try:
            if getattr(self, 'owner_gui', None) and hasattr(self.owner_gui, '_hide_spinner'):
                return self.owner_gui._hide_spinner(spinner)
        except Exception as e:
            logger.exception("ArchiveViewer: owner hide spinner failed: %s", e)
        try:
            if spinner:
                spinner.destroy()
        except Exception as e:
            logger.exception("ArchiveViewer: failed to destroy spinner: %s", e)

    def _run_in_background(self, func, on_done=None, on_error=None):
        """Run func() in a background thread and call on_done(result) or on_error(exc) in the main thread.
        Prefers owner's background runner when available."""
        try:
            if getattr(self, 'owner_gui', None) and hasattr(self.owner_gui, '_run_in_background'):
                return self.owner_gui._run_in_background(func, on_done=on_done, on_error=on_error)
        except Exception as e:
            logger.exception("ArchiveViewer: owner background runner failed: %s", e)

        def runner():
            try:
                res = func()
                if on_done:
                    try:
                        safe_ui_call(self, on_done, res)
                    except Exception as e:
                        logger.exception("ArchiveViewer: on_done callback failed: %s", e)
            except Exception as e:
                if on_error:
                    try:
                        safe_ui_call(self, on_error, e)
                    except Exception as e2:
                        logger.exception("ArchiveViewer: on_error callback failed: %s", e2)
        t = threading.Thread(target=runner, daemon=True)
        t.start()

    def _get_zip_class(self):
        try:
            import pyzipper  # type: ignore
            return pyzipper.AESZipFile
        except Exception:
            import zipfile  # Lazy import
            return zipfile.ZipFile

    def _read_zip_with_password(self, arch_path: str, read_fn, on_success, spinner_msg: str, decrypt_msg: str, err_title: str, err_prefix: str):
        ZipCls = self._get_zip_class()
        spinner = self._show_spinner(self, spinner_msg)

        def _read_no_pw():
            try:
                with ZipCls(arch_path, 'r') as zf:
                    return read_fn(zf)
            except RuntimeError as e:
                if "password" in str(e).lower():
                    return 'PASSWORD_REQUIRED'
                raise

        def _on_read(result):
            try:
                self._hide_spinner(spinner)
                if result == 'PASSWORD_REQUIRED':
                    dialog = ArchivePasswordDialog(self, prompt=f"Enter password for {os.path.basename(arch_path)}:", default="")
                    self.wait_window(dialog)
                    if not dialog.result:
                        return
                    archive_password = dialog.result

                    spinner2 = self._show_spinner(self, decrypt_msg)

                    def _read_with_pw():
                        with ZipCls(arch_path, 'r') as zf:
                            zf.setpassword(archive_password.encode('utf-8') if isinstance(archive_password, str) else archive_password)
                            return read_fn(zf)

                    def _on_pw_read(res):
                        try:
                            self._hide_spinner(spinner2)
                            on_success(res)
                        except Exception as e:
                            show_error(self, err_title, f"{err_prefix}: {e}")

                    def _on_pw_error(err):
                        self._hide_spinner(spinner2)
                        show_error(self, err_title, f"{err_prefix}: {err}")

                    self._run_in_background(_read_with_pw, on_done=_on_pw_read, on_error=_on_pw_error)
                    return

                on_success(result)
            except Exception as e:
                show_error(self, err_title, f"{err_prefix}: {e}")

        def _on_error(err):
            try:
                self._hide_spinner(spinner)
            except Exception:
                pass
            show_error(self, err_title, f"{err_prefix}: {err}")

        self._run_in_background(_read_no_pw, on_done=_on_read, on_error=_on_error)

    def _require_pyzipper(self, action_desc: str):
        try:
            import pyzipper  # type: ignore
            return pyzipper
        except Exception:
            try:
                if not self._ensure_pyzipper():
                    show_error(self, "Missing Dependency", "Unable to install pyzipper automatically.")
                    return None
                import pyzipper  # type: ignore
                return pyzipper
            except Exception:
                show_error(self, "Missing Dependency", f"pyzipper is required to {action_desc}.")
                return None

    def _select_archive(self, empty_message: str) -> Optional[Tuple[str, str]]:
        selected = self.tree.selection()
        if not selected:
            show_info(self, "Archive Encryption", empty_message)
            return None

        item = self.tree.item(selected[0])
        values = item.get("values") or ()
        archive_name = None
        if values and values[0] and str(values[0]).lower().endswith(".zip") and (len(values) == 1 or not values[1]):
            archive_name = values[0]
        elif (item.get("text") or "").lower().endswith(".zip") and not values:
            archive_name = item.get("text")

        if not archive_name or not str(archive_name).lower().endswith(".zip"):
            show_info(self, "Archive Encryption", "The file you have selected is not a zip file. Please select a zip file from the list.")
            return None

        archive_full = os.path.join(self.archive_dir, archive_name)
        if not os.path.exists(archive_full):
            show_error(self, "Archive Encryption", "Selected archive could not be found.")
            return None

        return archive_name, archive_full

    def _make_temp_path(self, archive_full: str) -> str:
        tmp_handle = tempfile.NamedTemporaryFile(delete=False, dir=os.path.dirname(archive_full), suffix=".tmp")
        temp_path = tmp_handle.name
        tmp_handle.close()
        return temp_path

    def _cleanup_temp(self, temp_path: Optional[str]) -> None:
        try:
            if temp_path and os.path.exists(temp_path):
                os.remove(temp_path)
        except Exception:
            pass

    def _encrypt_selected_archive(self):
        """Encrypt the selected zip archive with a password."""
        pyzipper = self._require_pyzipper("encrypt zip files")
        if not pyzipper:
            return
        selected = self._select_archive("Select a zip file from the list to encrypt.")
        if not selected:
            return
        archive_name, archive_full = selected

        # Check if archive already has encrypted entries
        temp_path = None
        try:
            with pyzipper.AESZipFile(archive_full, 'r') as zf_in:
                try:
                    names = zf_in.namelist()
                except RuntimeError as e:
                    if "password" in str(e).lower():
                        show_info(self, "Archive Encryption", "This zip is already password protected. Use 'Change Zip Password'.")
                        return
                    raise

                # Prompt for new password
                new_pw_dialog = ArchivePasswordDialog(self, prompt=f"Set password for {archive_name}:", default="")
                self.wait_window(new_pw_dialog)
                if not new_pw_dialog.result:
                    return
                new_password = new_pw_dialog.result

                temp_path = self._make_temp_path(archive_full)

                with pyzipper.AESZipFile(
                    temp_path,
                    'w',
                    compression=pyzipper.ZIP_DEFLATED,
                    encryption=pyzipper.WZ_AES,
                ) as zf_out:
                    zf_out.setpassword(new_password.encode('utf-8'))
                    zf_out.setencryption(pyzipper.WZ_AES, nbits=256)
                    for name in names:
                        data = zf_in.read(name)
                        zf_out.writestr(name, data)

            os.replace(temp_path, archive_full)
            show_info(self, "Archive Encryption", "Archive encrypted successfully.")
        except RuntimeError as e:
            logger.exception("archive_temp error: %s", e)
            self._cleanup_temp(temp_path)
            show_error(self, "Archive Encryption", f"Unable to encrypt archive: {e}")

    def _change_zip_password(self):
        """Change password for an already encrypted zip archive."""
        pyzipper = self._require_pyzipper("change zip passwords")
        if not pyzipper:
            return

        selected = self._select_archive("Select a zip file from the list to change its password.")
        if not selected:
            return
        archive_name, archive_full = selected

        old_pw_dialog = ArchivePasswordDialog(self, prompt=f"Enter CURRENT password for {archive_name}:", default="")
        self.wait_window(old_pw_dialog)
        if not old_pw_dialog.result:
            return
        old_password = old_pw_dialog.result

        new_pw_dialog = ArchivePasswordDialog(self, prompt=f"Set NEW password for {archive_name}:", default="")
        self.wait_window(new_pw_dialog)
        if not new_pw_dialog.result:
            return
        new_password = new_pw_dialog.result

        temp_path = None
        try:
            with pyzipper.AESZipFile(archive_full, 'r') as zf_in:
                zf_in.setpassword(old_password.encode('utf-8'))
                names = zf_in.namelist()
                temp_path = self._make_temp_path(archive_full)

                with pyzipper.AESZipFile(
                    temp_path,
                    'w',
                    compression=pyzipper.ZIP_DEFLATED,
                    encryption=pyzipper.WZ_AES,
                ) as zf_out:
                    zf_out.setpassword(new_password.encode('utf-8'))
                    zf_out.setencryption(pyzipper.WZ_AES, nbits=256)
                    for name in names:
                        data = zf_in.read(name)
                        zf_out.writestr(name, data)

            os.replace(temp_path, archive_full)
            show_info(self, "Archive Encryption", "Password updated successfully.")
        except Exception as e:
            logger.exception("archive_temp error: %s", e)
            self._cleanup_temp(temp_path)
            show_error(self, "Archive Encryption", f"Unable to change password: {e}")

    def _ensure_pyzipper(self) -> bool:
        """Attempt to install pyzipper silently using the current Python executable."""
        try:
            cmd = [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "pyzipper"]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            return result.returncode == 0
        except Exception:
            return False

    def load_archive_list(self):
        """Load list of monthly archives."""
        if not os.path.exists(self.archive_dir):
            return

        archives = [f for f in os.listdir(self.archive_dir) if f.endswith(".zip")]
        archives.sort(reverse=True)

        for arch in archives:
            arch_node = self.tree.insert("", "end", text=arch, values=(arch, ""))

    def on_select(self, event):
        selected = self.tree.selection()
        if not selected:
            return
        item = self.tree.item(selected[0])
        values = item.get("values") or ()
        
        if not values:
            return
        
        # If selecting archive node, load its contents (no password prompt yet)
        if len(values) == 1 or not values[1]:
            archive_name = values[0]
            # Load archive contents
            self.tree.delete(*self.tree.get_children(selected[0]))
            self.load_archive_contents(archive_name, selected[0])
        else:
            # Otherwise it's a file node, view its contents
            archive_name, internal_path = values[0], values[1]
            if internal_path:
                self.view_archive_file(archive_name, internal_path)

    def load_archive_contents(self, archive_name, parent_node):
        """List files in the ZIP archive (with or without password protection)."""
        arch_path = os.path.join(self.archive_dir, archive_name)

        def _populate_tree(names_list):
            try:
                self.tree.delete(*self.tree.get_children(parent_node))
                month_nodes = {}
                for internal_path in names_list:
                    if not internal_path.endswith('.txt'):
                        continue
                    internal_path = internal_path.replace('\\', '/')
                    if '/' in internal_path:
                        m_folder, c_file = internal_path.split('/', 1)
                        if m_folder not in month_nodes:
                            month_nodes[m_folder] = self.tree.insert(parent_node, "end", text=m_folder)
                        display_name = c_file.replace(".txt", "").replace("_", " ")
                        self.tree.insert(month_nodes[m_folder], "end", text=display_name, values=(archive_name, internal_path))
            except Exception as e:
                show_error(self, "Archive Error", f"Error loading archive contents: {e}")

        self._read_zip_with_password(
            arch_path,
            read_fn=lambda zf: zf.namelist(),
            on_success=_populate_tree,
            spinner_msg=f"Loading {archive_name}...",
            decrypt_msg=f"Decrypting {archive_name}...",
            err_title="Archive Error",
            err_prefix="Error loading archive contents",
        )

    def view_archive_file(self, archive_name, internal_path):
        """Extract and display file from ZIP (with or without password protection)."""
        arch_path = os.path.join(self.archive_dir, archive_name)

        def _render_content(raw):
            content = raw.decode('utf-8') if isinstance(raw, bytes) else str(raw)
            self.title_lbl.config(text=f"Viewing: {os.path.basename(internal_path)}")
            self.text_view.config(state=tk.NORMAL)
            self.text_view.delete("1.0", tk.END)
            self.text_view.insert(tk.END, content)
            self.text_view.config(state=tk.DISABLED)

        self._read_zip_with_password(
            arch_path,
            read_fn=lambda zf: zf.read(internal_path),
            on_success=_render_content,
            spinner_msg=f"Reading {os.path.basename(internal_path)}...",
            decrypt_msg=f"Decrypting {os.path.basename(internal_path)}...",
            err_title="Error",
            err_prefix="Could not read archived file",
        )

class WorkflowGUI:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("Candidate Tracker")
        self.root.geometry("1500x1000")
        self.root.resizable(True, True)
        try:
            center_window(self.root)
        except Exception:
            pass
        
        # Initialize managers and state objects
        ensure_dirs(
            APP_DATA_DIR,
            os.path.join(APP_DATA_DIR, "Archive"),
            os.path.join(APP_DATA_DIR, "exports"),
            os.path.join(APP_DATA_DIR, "Backups"),
        )
        # File paths (simplified - no PathManager class overhead)
        self.data_dir = APP_DATA_DIR
        self.auth_file = os.path.join(self.data_dir, "prog_auth.json")
        self.enc_file = os.path.join(self.data_dir, "workflow_data.json.enc")
        self.data_file = os.path.join(self.data_dir, "workflow_data.json")
        self.archive_dir = os.path.join(self.data_dir, ARCHIVE_DIR_NAME)
        self.exports_dir = os.path.join(self.data_dir, EXPORTS_DIR_NAME)
        self.theme_pref_file = os.path.join(self.data_dir, THEME_PREF_FILE)

        # Theme setup
        self._init_theme()
        self._setup_hotkeys()
        
        # Theme manager for color access
        self._update_colors_from_theme()
        
        # Shared form fonts and styles
        self.form_label_font = FONTS["small"]
        self.form_entry_font = FONTS["small"]
        self.small_font = FONTS["tiny"]
        self.bold_font = FONTS["button"]
        
        # Shared card styles
        self._init_card_styles()
        
        # UI state trackers
        self._flash_states = {}
        self._flash_counter = 0
        self._pending_flash_id = None
        self._scroll_top_offset = SCROLL_TOP_OFFSET
        self._scroll_view_margin = SCROLL_VIEW_MARGIN
        self._autosave_interval_ms = AUTOSAVE_INTERVAL_MS
        self._autosave_after_id = None
        self._settings_menu = None
        self._settings_btn = None
        self._settings_theme_btn = None
        self._files_menu = None
        self._files_btn = None
        
        # Filter state (simplified - no dataclass overhead)
        self.filter_branch = "All"
        self.filter_manager = "All"
        self.filter_has_bg_cleared = False
        self.filter_has_cori_cleared = False
        self.filter_has_nh_cleared = False
        self.filter_has_me_cleared = False
        self.filter_show_unscheduled = True
        self.filter_show_scheduled = True
        self._last_filter_state = None
        
        # Search state (simplified - no dataclass overhead)
        self.search_query = ""
        self.search_matches = []
        self.search_current_index = -1
        self._search_apply_after_id = None
        self._render_limits = {"scheduled": 200, "unscheduled": 200}
        self._last_render_signature = None
        self._last_render_context = None

        # UI widget registry for incremental updates & virtualization
        # maps person id -> card widget
        self._person_widgets: Dict[int, tk.Widget] = {}
        # average card heights to help virtual window estimation (px)
        self._avg_card_height: Dict[str, int] = {"scheduled": 120, "unscheduled": 60}
        # thresholds for activating virtualization
        self._virtualize_threshold = 400  # items
        
        self.root.configure(bg=CURRENT_PALETTE["bg_color"])
        
        # Data initialization
        self.people_data: List[Dict[str, Any]] = []
        self.security = None
        self.master_password = None
        
        # Security and data loading
        if not self.run_security_check():
            self.root.destroy()
            return
        
        self._migrate_codes_safe()
        self._normalize_all_people()
        
        # Create UI and render
        self.create_widgets()
        self.refresh_blocks()
        self._apply_chrome_styling()

    def _normalize_person_fields(self, person: Dict[str, Any]) -> None:
        try:
            self._ensure_person_uid(person)
            person["_norm_name"] = _normalize_text(person.get("Name", ""))
            person["_norm_branch"] = _normalize_text(person.get("Branch", ""))
            person["_norm_manager"] = _normalize_text(person.get("Manager Name", ""))
        except (AttributeError, TypeError):
            pass

    def _ensure_person_uid(self, person: Dict[str, Any]) -> str:
        try:
            uid = (person.get("_uid") or "").strip()
            if uid:
                return uid
            uid = uuid.uuid4().hex
            person["_uid"] = uid
            return uid
        except Exception:
            # Fallback to stable string even if mutation fails
            return uuid.uuid4().hex

    def _normalize_all_people(self) -> None:
        try:
            for person in self.people_data:
                self._normalize_person_fields(person)
        except Exception:
            pass

    def _build_render_signature(self) -> Tuple:
        try:
            return tuple(
                (
                    (p.get("Employee ID", "") or ""),
                    (p.get("Name", "") or ""),
                    (p.get("NEO Scheduled Date", "") or ""),
                    (p.get("Branch", "") or ""),
                    (p.get("Manager Name", "") or ""),
                )
                for p in (self.people_data or [])
            )
        except Exception:
            return ()

    
    def _init_theme(self) -> None:
        """Initialize theme engine and load preferences."""
        self._theme_engine, self._tb_style = None, None
        self._current_theme = load_theme_pref(self.theme_pref_file, default='light')
        
        # Theme engine removed for simplicity
    
    def _setup_hotkeys(self) -> None:
        """Setup keyboard shortcuts for theme toggling."""
        self.root.bind('<F6>', lambda e: self.toggle_theme())
        self.root.bind('<Control-Shift-D>', lambda e: self.toggle_theme())
        self.root.bind('<Control-d>', lambda e: self.toggle_theme())
        self.root.bind('<Control-f>', lambda e: self._show_filters_and_focus_search())
    
    def _update_colors_from_theme(self) -> None:
        """Update color attributes from theme manager."""
        self.bg_color = CURRENT_PALETTE["bg_color"]
        self.fg_color = CURRENT_PALETTE["fg_color"]
        self.accent_color = CURRENT_PALETTE["accent_color"]
        self.button_color = CURRENT_PALETTE["button_color"]
        self.error_color = CURRENT_PALETTE["error_color"]
        self.warning_color = CURRENT_PALETTE["warning_color"]
        self.card_bg_color = CURRENT_PALETTE["card_bg_color"]

    def _apply_theme_palette(self, pal: Dict[str, str], refs: Dict[str, Any]) -> None:
        """Apply palette and update local color tokens."""
        apply_palette(self.root, pal, refs)
        try:
            apply_chrome_tokens(refs)
        except Exception:
            pass
        self.bg_color = pal["bg_color"]
        self.fg_color = pal["fg_color"]
        self.accent_color = pal["accent_color"]
        self.ribbon_color = pal.get("ribbon_color", pal["accent_color"])
        self.button_color = pal["button_color"]
        self.error_color = pal["error_color"]
        self.warning_color = pal["warning_color"]
        self.card_bg_color = pal["card_bg_color"]
    
    def _init_card_styles(self) -> None:
        """Initialize shared card styling."""
        styles = make_card_styles(self.card_bg_color, self.accent_color)
        self.card_lbl_style = styles["lbl"]
        self.card_val_style = styles["val"]
        self.card_accent_lbl = styles["accent_lbl"]
        self.card_accent_small = styles["accent_small"]

    def _show_filters_and_focus_search(self):
        try:
            self._filters_visible = True
            self._animate_filters(True)
            if hasattr(self, "search_entry") and self.search_entry is not None:
                self.search_entry.focus_set()
                try:
                    self.search_entry.select_range(0, tk.END)
                except Exception:
                    pass
        except Exception:
            pass

    def _hide_filters(self):
        try:
            self._filters_visible = False
            self._animate_filters(False)
        except Exception:
            pass
    
    def _migrate_codes_safe(self) -> None:
        """Safely run code migration with error handling."""
        try:
            self._migrate_codes()
        except (OSError, IOError, ValueError, KeyError):
            pass  # Migration is non-critical
    
    def _apply_chrome_styling(self) -> None:
        """Apply chrome styling to UI components."""
        try:
            refs = {
                'title_frame': getattr(self, 'title_frame', None),
                'title_label': getattr(self, 'title_label', None),
                'search_container': getattr(self, 'search_container', None),
                'filters_container': getattr(self, 'filters_container', None),
                'filters_frame': getattr(self, 'filters_frame', None),
                'container': getattr(self, 'container', None),
                'scrollable_frame': getattr(self, 'scrollable_frame', None),
                'canvas': getattr(self, 'canvas', None),
                'dashboard_frame': getattr(self, 'dashboard_frame', None),
                'left_col': getattr(self, 'left_col', None),
                'right_col': getattr(self, 'right_col', None),
            }
            apply_chrome_tokens(refs)
        except (AttributeError, TypeError, KeyError):
            pass
    
    # Filter/search state helpers removed; direct state is updated where needed.

    # Helper to create a labeled grid Entry inside a parent frame and return the Entry widget
    def _label_and_entry(self, parent, label_text, row, label_col=0, entry_col=1, colspan=1, entry_kwargs=None):
        text = label_text if str(label_text).strip().endswith(":") else f"{label_text}:"
        tk.Label(parent, text=text, bg=self.bg_color, fg=self.fg_color, font=self.form_label_font).grid(row=row, column=label_col, sticky="w", pady=5)
        # Use themed card background and foreground for all form entries
        field_bg = getattr(self, 'card_bg_color', CURRENT_PALETTE.get('card_bg_color', '#ffffff'))
        entry = tk.Entry(parent, font=self.form_entry_font, bg=field_bg, fg=self.fg_color, insertbackground=self.fg_color, **(entry_kwargs or {}))
        entry.grid(row=row, column=entry_col, columnspan=colspan, sticky="ew", padx=(10, 0), pady=5)
        return entry

    def _build_entry_fields(self, parent, fields, entries, person=None, label_col=0, entry_col=1, colspan=1):
        """Build a set of labeled entries from (label, key) field tuples."""
        for i, (label, key) in enumerate(fields):
            entry = self._label_and_entry(parent, label, i, label_col=label_col, entry_col=entry_col, colspan=colspan)
            if person and key in person:
                entry.insert(0, person[key])
            entries[key] = entry

    def _create_checkbox(self, parent, text, variable, font="small", side=tk.LEFT, padx=(4, 8), **kwargs):
        """Create a styled checkbox widget and pack it."""
        checkbox_kwargs = {
            "bg": self.bg_color,
            "fg": self.fg_color,
            "activeforeground": self.fg_color,
            "selectcolor": CURRENT_PALETTE.get('checkbox_select_color', '#000000'),
            "font": FONTS[font],
        }
        checkbox_kwargs.update(kwargs)
        cb = tk.Checkbutton(parent, text=text, variable=variable, **checkbox_kwargs)
        cb.pack(side=side, padx=padx)
        return cb

    def _create_radiobutton(self, parent, text, variable, value, font="small", side=tk.LEFT, padx=(0, 10), **kwargs):
        """Create a styled radiobutton widget and pack it."""
        rb_kwargs = {
            "bg": self.bg_color,
            "fg": self.fg_color,
            "selectcolor": CURRENT_PALETTE.get('checkbox_select_color', '#000000'),
            "activebackground": self.bg_color,
            "activeforeground": self.fg_color,
            "font": FONTS[font],
        }
        rb_kwargs.update(kwargs)
        rb = tk.Radiobutton(parent, text=text, variable=variable, value=value, **rb_kwargs)
        rb.pack(side=side, padx=padx)
        return rb

    def run_security_check(self):
        """Program first-time setup and data encryption handling.

        This flow enforces a stored program password (hashed) located at
        `data/prog_auth.json`. To reset the program password delete that
        file.
        """
        # --- Program password (first-time setup) ---
        if not os.path.exists(self.auth_file):
            # First run: ask user to create a program password
            dialog = LoginDialog(self.root, task="create")
            self.root.wait_window(dialog)
            if not dialog.result:
                return False
            cred = _hash_password(dialog.result)
            try:
                with open(self.auth_file, 'w', encoding='utf-8') as f:
                    json.dump(cred, f)
                try:
                    os.chmod(self.auth_file, 0o600)
                except Exception:
                    pass
            except Exception as e:
                show_error(self.root, "Error", f"Could not save program password: {e}")
                return False
            # set master password for DB encryption
            self.master_password = dialog.result
        else:
            # Existing install: prompt for program password and verify
            try:
                with open(self.auth_file, 'r', encoding='utf-8') as f:
                    stored = json.load(f)
                salt = stored.get('salt')
                iters = int(stored.get('iterations', 200000))
                key = stored.get('key')
            except Exception as e:
                show_error(self.root, "Error", f"Program auth file cannot be read: {e}")
                return False

            while True:
                dialog = LoginDialog(self.root, task="login")
                self.root.wait_window(dialog)
                if not dialog.result:
                    return False
                if _verify_password(dialog.result, salt, iters, key):
                    self.master_password = dialog.result
                    break
                else:
                    show_error(self.root, "Error", "Incorrect program password. Access denied.")

        # Initialize SecurityManager for DB encryption using program password
        self.security = SecurityManager(self.master_password)

        # --- Legacy migration: plaintext JSON -> encrypted file ---
        if os.path.exists(self.data_file) and not os.path.exists(self.enc_file):
            msg = "A legacy plain-text database was found. It will be encrypted with your program password."
            show_info(self.root, "Security Migration", msg)
            try:
                with open(self.data_file, 'r', encoding='utf-8') as f:
                    self.people_data = json.load(f)
                self.save_data()
                os.remove(self.data_file)
                show_info(self.root, "Success", "Database migrated and encrypted successfully.")
            except (OSError, IOError, json.JSONDecodeError) as e:
                show_error(self.root, "Error", f"Migration failed: {e}")
                return False

        # --- Normal load: decrypt existing encrypted DB if present ---
        self.load_data()

        return True

    def load_data(self) -> None:
        """Load data from encrypted JSON file"""
        if os.path.exists(self.enc_file):
            try:
                if not self.security:
                    raise RuntimeError("Security manager is not initialized.")
                decrypted_json = self.security.decrypt(self.enc_file)
                if decrypted_json:
                    self.people_data = json.loads(decrypted_json)
                else:
                    raise RuntimeError("Decryption returned empty or failed.")
            except (OSError, IOError, json.JSONDecodeError, RuntimeError) as e:
                show_error(self.root, "Load Error", f"Could not decrypt/load data:\n{str(e)}")
                self.people_data = []
        else:
            self.people_data = []

    def _migrate_codes(self) -> None:
        """Backfill code fields and canonicalize display values for dropdowns."""
        _migrate_codes_in_place(self.people_data)

    def save_data(self) -> None:
        """Save data to encrypted JSON file"""
        try:
            json_str = json.dumps(self.people_data, indent=4)
            if not self.security:
                raise RuntimeError("Security manager is not initialized.")
            if not self.security.encrypt(json_str, self.enc_file):
                raise RuntimeError("OpenSSL encryption process failed.")
        except (OSError, IOError, json.JSONDecodeError, RuntimeError) as e:
            show_error(self.root, "Save Error", f"Could not encrypt/save data:\n{str(e)}")

    def create_widgets(self):
        # Title Frame
        self.title_frame = tk.Frame(self.root, bg=self.accent_color, height=64)
        self.title_frame.pack(fill=tk.X, pady=(0, 10))
        self.title_frame.pack_propagate(False)
        
        self.title_label = tk.Label(
            self.title_frame,
            text="Candidate Tracker",
            font=FONTS["header"],
            bg=self.accent_color,
            fg="white"
        )
        self.title_label.pack(side=tk.LEFT, padx=20)
        
        # Search moved to filters section (Ctrl+F opens filters and focuses search)
        # Add Button in Title Bar
        pack_action_button(self.title_frame, "Add Candidate", self.open_add_dialog, role="add", font=FONTS["button"], width=14, side=tk.RIGHT, padx=10)
        
        # Compact stacked Export/Archives group to the right
        # Right-side stacked action column; match ribbon color
        self._title_stack = tk.Frame(self.title_frame, bg=getattr(self, 'ribbon_color', self.accent_color))
        self._title_stack.pack(side=tk.RIGHT, padx=8)
        # Longer single-line labels per preference; keep compact padding
        pack_action_button(self._title_stack, "Weekly Tracker", self.open_weekly_tracker, role="view", font=FONTS["micro_bold"], width=18, compact=True, side=tk.TOP, pady=2)
        # Settings dropdown (Change Password + Theme)
        try:
            self._settings_btn = pack_action_button(self.title_frame, "Settings ▾", self._toggle_settings_menu, role="charcoal", font=FONTS["button"], width=12, side=tk.RIGHT, padx=10)
        except Exception:
            self._settings_btn = None
        # Files dropdown (Open/View/Export)
        try:
            self._files_btn = pack_action_button(self.title_frame, "Files ▾", self._toggle_files_menu, role="charcoal", font=FONTS["button"], width=10, side=tk.RIGHT, padx=6)
        except Exception:
            self._files_btn = None

        # Filters Bar (collapsible with slide animation)
        self._filters_visible = True
        # Filters container for slide animation
        self.filters_container = tk.Frame(self.root, bg=self.bg_color, height=1)
        self.filters_container.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=(0, 6))
        self.filters_container.pack_propagate(False)
        self.filters_frame = tk.Frame(self.filters_container, bg=self.bg_color)
        self.filters_frame.pack(fill=tk.X)
        tk.Label(self.filters_frame, text=DIALOG_FIELD_LABELS['branch'], bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT)
        self._branch_var = tk.StringVar(value=self.filter_branch)
        branch_vals = BRANCH_OPTIONS
        ttk.Combobox(self.filters_frame, textvariable=self._branch_var, values=branch_vals, state="readonly", width=WIDGET_WIDTHS['branch_combo']).pack(side=tk.LEFT, padx=(6, 12))
        tk.Label(self.filters_frame, text="Mgr:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT)
        self._manager_var = tk.StringVar(value=self.filter_manager)
        mgr_vals = ["All"] + sorted(list({(p.get("Manager Name") or '').strip() for p in self.people_data if p.get("Manager Name")}))
        ttk.Combobox(self.filters_frame, textvariable=self._manager_var, values=mgr_vals, state="readonly", width=WIDGET_WIDTHS['manager_combo']).pack(side=tk.LEFT, padx=(6, 12))
        self._bg_var = tk.BooleanVar(value=self.filter_has_bg_cleared)
        self._cori_var = tk.BooleanVar(value=self.filter_has_cori_cleared)
        self._nh_var = tk.BooleanVar(value=self.filter_has_nh_cleared)
        self._me_var = tk.BooleanVar(value=self.filter_has_me_cleared)
        self._create_checkbox(self.filters_frame, "BG", self._bg_var)
        self._create_checkbox(self.filters_frame, "CORI", self._cori_var)
        self._create_checkbox(self.filters_frame, "NH GC", self._nh_var)
        self._create_checkbox(self.filters_frame, "ME GC", self._me_var)
        self._unsched_var = tk.BooleanVar(value=self.filter_show_unscheduled)
        self._sched_var = tk.BooleanVar(value=self.filter_show_scheduled)
        self._create_checkbox(self.filters_frame, "Show Unscheduled", self._unsched_var, padx=(12, 8))
        self._create_checkbox(self.filters_frame, "Show Scheduled", self._sched_var)

        # Search Box (Name lookup) + Prev/Next in filters bar
        self.search_var = tk.StringVar()
        self.search_entry, self.search_container = build_search_bar(self.filters_frame, self.search_var, self.search_person)
        self.search_container.pack(side=tk.LEFT, padx=(12, 0))
        pack_action_button(self.search_container, "<", self.search_prev, role="charcoal", font=FONTS["button"], padx=2)
        pack_action_button(self.search_container, ">", self.search_next, role="charcoal", font=FONTS["button"], padx=2)
        try:
            self.search_var.trace_add("write", lambda *args: self._on_search_change())
        except Exception:
            pass

        # Close filters button (X) on the right
        pack_action_button(self.filters_frame, "X", self._hide_filters, role="charcoal", font=FONTS["button"], side=tk.RIGHT, padx=10)

        # Auto-apply filters when any control changes
        def _bind_auto_apply(var):
            try:
                var.trace_add("write", lambda *args: self._on_filter_change())
            except Exception:
                pass
        for v in (self._branch_var, self._manager_var, self._bg_var, self._cori_var, self._nh_var, self._me_var, self._unsched_var, self._sched_var):
            _bind_auto_apply(v)

        # Scrollable Canvas Area
        self.container = tk.Frame(self.root, bg=self.bg_color)
        self.container.pack(fill=tk.BOTH, expand=True, padx=12, pady=10)
        
        self.canvas = tk.Canvas(self.container, bg=self.bg_color, highlightthickness=0)
        scrollbar = ttk.Scrollbar(self.container, orient="vertical", command=self.canvas.yview)
        
        self.scrollable_frame = tk.Frame(self.canvas, bg=self.bg_color)
    
        self.scrollable_frame.bind(
            "<Configure>",
            lambda e: self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        )
    
        self.canvas_window = self.canvas.create_window((0, 0), window=self.scrollable_frame, anchor="nw", width=960)
        self.canvas.configure(yscrollcommand=scrollbar.set)
    
        # Dual-Column Structure inside scrollable_frame
        self.dashboard_frame = tk.Frame(self.scrollable_frame, bg=self.bg_color)
        self.dashboard_frame.pack(fill=tk.BOTH, expand=True)
        self.dashboard_frame.columnconfigure(0, weight=1) # Left - Unscheduled (Compact)
        self.dashboard_frame.columnconfigure(1, weight=4) # Right - Scheduled (Detailed)
        
        self.left_col = tk.Frame(self.dashboard_frame, bg=self.bg_color)
        self.left_col.grid(row=0, column=0, sticky="nsew", padx=(0, 4))
        
        self.right_col = tk.Frame(self.dashboard_frame, bg=self.bg_color)
        self.right_col.grid(row=0, column=1, sticky="nsew")
    
        self.canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
    
        # Bind mousewheel to canvas and all its children
        self.bind_mousewheel(self.root, self._on_mousewheel)
    
        # Dynamic canvas width adjustment
        self.container.bind("<Configure>", self._on_frame_configure)
        # Autosave scheduling
        self._schedule_autosave()

        # Initialize filters container to natural height
        try:
            self.root.update_idletasks()
            h = max(0, self.filters_frame.winfo_reqheight())
            self._set_filters_height(h)
        except Exception:
            pass
        # Apply initial palette to UI
        try:
            refs = {
                'title_frame': self.title_frame,
                'title_label': self.title_label,
                'search_container': self.search_container,
                'title_stack': getattr(self, '_title_stack', None),
                'filters_container': self.filters_container,
                'filters_frame': self.filters_frame,
                'container': self.container,
                'scrollable_frame': self.scrollable_frame,
                'canvas': self.canvas,
                'dashboard_frame': self.dashboard_frame,
                'left_col': self.left_col,
                'right_col': self.right_col,
            }
            pal = get_palette(self._current_theme)
            self._apply_theme_palette(pal, refs)
            self._apply_palette()
        except Exception:
            pass

    def _recompute_styles(self):
        """Recompute shared card styles after palette change."""
        try:
            styles = make_card_styles(self.card_bg_color, self.accent_color)
            self.card_lbl_style = styles["lbl"]
            self.card_val_style = styles["val"]
            self.card_accent_lbl = styles["accent_lbl"]
            self.card_accent_small = styles["accent_small"]
        except Exception:
            pass

    def _apply_palette(self):
        """Apply current palette to top-level frames and rebuild blocks."""
        try:
            # Root and containers
            self.root.configure(bg=self.bg_color)
            for w in (
                self.title_frame,
                self.filters_container,
                self.filters_frame,
                self.container,
                self.scrollable_frame,
                self.dashboard_frame,
                self.left_col,
                self.right_col,
            ):
                try:
                    if w is not None:
                        # Title frame uses accent
                        if w is self.title_frame:
                            w.configure(bg=getattr(self, 'ribbon_color', self.accent_color))
                        else:
                            w.configure(bg=self.bg_color)
                except Exception:
                    pass
            try:
                self.canvas.configure(bg=self.bg_color)
            except Exception:
                pass
            try:
                if self.title_label:
                    self.title_label.configure(bg=getattr(self, 'ribbon_color', self.accent_color), fg="white")
            except Exception:
                pass
            try:
                if getattr(self, '_title_stack', None) is not None:
                    self._title_stack.configure(bg=getattr(self, 'ribbon_color', self.accent_color))
            except Exception:
                pass
            # Ensure bottom filters/search bar picks up palette changes
            try:
                self._apply_filter_palette()
            except Exception:
                pass
            # Recompute styles used by person blocks and refresh
            self._recompute_styles()
            self.refresh_blocks()
        except Exception:
            pass

    def _apply_filter_palette(self):
        """Apply palette to filter bar widgets (labels, checkboxes, comboboxes, search)."""
        try:
            field_bg = getattr(self, 'card_bg_color', CURRENT_PALETTE.get('card_bg_color', self.bg_color))
            # Frames
            if getattr(self, 'filters_container', None) is not None:
                self.filters_container.configure(bg=self.bg_color)
            if getattr(self, 'filters_frame', None) is not None:
                self.filters_frame.configure(bg=self.bg_color)
            # ttk combobox style
            try:
                style = ttk.Style()
                style.configure(
                    "Filters.TCombobox",
                    fieldbackground=field_bg,
                    background=field_bg,
                    foreground=self.fg_color,
                    arrowcolor=self.fg_color,
                )
                style.map(
                    "Filters.TCombobox",
                    fieldbackground=[("readonly", field_bg)],
                    foreground=[("readonly", self.fg_color)],
                    background=[("readonly", field_bg)],
                )
            except Exception:
                pass
            # Child widgets
            if getattr(self, 'filters_frame', None) is not None:
                for child in self.filters_frame.winfo_children():
                    try:
                        if isinstance(child, tk.Label):
                            child.configure(bg=self.bg_color, fg=self.fg_color)
                        elif isinstance(child, tk.Checkbutton):
                            child.configure(
                                bg=self.bg_color,
                                fg=self.fg_color,
                                activeforeground=self.fg_color,
                                selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'),
                            )
                        elif isinstance(child, tk.Frame):
                            child.configure(bg=self.bg_color)
                        elif isinstance(child, ttk.Combobox):
                            child.configure(style="Filters.TCombobox")
                    except Exception:
                        pass
            # Search bar
            if getattr(self, 'search_container', None) is not None:
                try:
                    self.search_container.configure(bg=self.bg_color)
                except Exception:
                    pass
            if getattr(self, 'search_entry', None) is not None:
                try:
                    self.search_entry.configure(
                        bg=field_bg,
                        fg=self.fg_color,
                        insertbackground=self.fg_color,
                    )
                except Exception:
                    pass
        except Exception:
            pass

    def toggle_theme(self):
        """Toggle between light and dark themes across available engines."""
        try:
            new_t = 'light' if (getattr(self, '_current_theme', 'light') == 'dark') else 'dark'
            # Apply engine theme via helpers
            # Theme engine removed for simplicity
            self._current_theme = new_t
            # Get palette and apply across UI
            refs = {
                'title_frame': self.title_frame,
                'title_label': self.title_label,
                'search_container': self.search_container,
                'title_stack': getattr(self, '_title_stack', None),
                'filters_container': self.filters_container,
                'filters_frame': self.filters_frame,
                'container': self.container,
                'scrollable_frame': self.scrollable_frame,
                'canvas': self.canvas,
                'dashboard_frame': self.dashboard_frame,
                'left_col': self.left_col,
                'right_col': self.right_col,
            }
            pal = get_palette(self._current_theme)
            self._apply_theme_palette(pal, refs)
            # Recompute styles and apply palette to all chrome
            self._apply_palette()
            # Update button label if present
            try:
                btn = getattr(self, '_theme_btn', None)
                if btn is not None:
                    btn.config(text=f"Theme: {self._current_theme.capitalize()}")
            except Exception:
                pass
            # Persist preference (1=light, 2=dark)
            save_theme_pref(self.theme_pref_file, self._current_theme)
            try:
                self.root.update_idletasks()
            except Exception:
                pass
            try:
                btn = getattr(self, '_settings_theme_btn', None)
                if btn is not None:
                    btn.config(text=f"Theme: {self._current_theme.capitalize()}")
            except Exception:
                pass
        except Exception:
            pass

    def _toggle_settings_menu(self):
        if self._files_menu and self._files_menu.winfo_exists():
            self._close_files_menu()
        if self._settings_menu and self._settings_menu.winfo_exists():
            self._close_settings_menu()
        else:
            self._open_settings_menu()

    def _toggle_files_menu(self):
        if self._settings_menu and self._settings_menu.winfo_exists():
            self._close_settings_menu()
        if self._files_menu and self._files_menu.winfo_exists():
            self._close_files_menu()
        else:
            self._open_files_menu()

    def _open_settings_menu(self):
        if not self._settings_btn:
            return
        menu = tk.Toplevel(self.root)
        self._settings_menu = menu
        menu.overrideredirect(True)
        menu.configure(bg=self.bg_color)

        try:
            menu.attributes("-topmost", True)
        except Exception:
            pass

        # Position just below the settings button
        try:
            x = self._settings_btn.winfo_rootx()
            y = self._settings_btn.winfo_rooty() + self._settings_btn.winfo_height()
            menu.geometry(f"220x110+{x}+{y}")
        except Exception:
            pass

        frame = tk.Frame(menu, bg=self.bg_color, padx=8, pady=8)
        frame.pack(fill=tk.BOTH, expand=True)

        btn_change = make_action_button(frame, "Change Password", self.change_program_password, role="edit", font=FONTS["button"], width=18)
        btn_change.pack(fill=tk.X, pady=(0, 6))

        current = getattr(self, '_current_theme', 'light')
        self._settings_theme_btn = make_action_button(frame, f"Theme: {current.capitalize()}", self.toggle_theme, role="charcoal", font=FONTS["button"], width=18)
        self._settings_theme_btn.pack(fill=tk.X)

        menu.bind("<FocusOut>", lambda e: self._close_settings_menu())
        menu.focus_set()
        self.root.bind("<Button-1>", self._on_root_click, add="+")

    def _open_files_menu(self):
        if not self._files_btn:
            return
        menu = tk.Toplevel(self.root)
        self._files_menu = menu
        menu.overrideredirect(True)
        menu.configure(bg=self.bg_color)

        try:
            menu.attributes("-topmost", True)
        except Exception:
            pass

        # Position just below the files button
        try:
            x = self._files_btn.winfo_rootx()
            y = self._files_btn.winfo_rooty() + self._files_btn.winfo_height()
            menu.geometry(f"220x180+{x}+{y}")
        except Exception:
            pass

        frame = tk.Frame(menu, bg=self.bg_color, padx=8, pady=8)
        frame.pack(fill=tk.BOTH, expand=True)

        btn_open_loc = make_action_button(frame, "Open File Location", lambda: self._open_path_in_file_manager(self.data_dir), role="view", font=FONTS["button"], width=18)
        btn_open_loc.pack(fill=tk.X, pady=(0, 6))
        btn_view_csv = make_action_button(frame, "View CSV Files", self.open_csv_viewer_dialog, role="view", font=FONTS["button"], width=18)
        btn_view_csv.pack(fill=tk.X, pady=(0, 6))
        btn_view_arch = make_action_button(frame, "View Archives", self.open_archive_viewer, role="view", font=FONTS["button"], width=18)
        btn_view_arch.pack(fill=tk.X, pady=(0, 6))
        btn_snapshots = make_action_button(frame, "Snapshots", self.open_snapshot_dialog, role="view", font=FONTS["button"], width=18)
        btn_snapshots.pack(fill=tk.X, pady=(0, 6))
        btn_export = make_action_button(frame, "Export CSV", self.export_current_view_csv, role="save", font=FONTS["button"], width=18)
        btn_export.pack(fill=tk.X)

        menu.bind("<FocusOut>", lambda e: self._close_files_menu())
        menu.focus_set()
        self.root.bind("<Button-1>", self._on_root_click, add="+")

    def _close_settings_menu(self):
        try:
            if self._settings_menu and self._settings_menu.winfo_exists():
                self._settings_menu.destroy()
        except Exception:
            pass
        self._settings_menu = None

    def _close_files_menu(self):
        try:
            if self._files_menu and self._files_menu.winfo_exists():
                self._files_menu.destroy()
        except Exception:
            pass
        self._files_menu = None

    def open_snapshot_dialog(self):
        """Show snapshot manager for creating and restoring snapshots."""
        ensure_dirs(self._get_snapshots_dir())

        win = tk.Toplevel(self.root)
        win.title("Snapshots")
        win.configure(bg=self.bg_color)
        win.geometry("640x420")
        win.transient(self.root)
        try:
            center_window(win, self.root)
        except Exception:
            pass

        frame = tk.Frame(win, bg=self.bg_color, padx=12, pady=12)
        frame.pack(fill=tk.BOTH, expand=True)

        tk.Label(
            frame,
            text="Select a snapshot to restore or create a new one.",
            bg=self.bg_color,
            fg=self.fg_color,
            font=FONTS["small"],
        ).pack(anchor="w")

        list_frame = tk.Frame(frame, bg=self.bg_color)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=8)

        listbox = tk.Listbox(list_frame, font=FONTS["small"])
        listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        sb = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=listbox.yview)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        listbox.configure(yscrollcommand=sb.set)

        snapshots: List[Dict[str, Any]] = []

        def _label_for(snap: Dict[str, Any]) -> str:
            ts = snap.get("timestamp")
            ts_str = ts.strftime("%Y-%m-%d %H:%M:%S") if ts else "Unknown"
            size = snap.get("size", 0)
            kb = max(1, int(size / 1024))
            return f"{ts_str}  ({kb} KB)  -  {snap.get('filename', '')}"

        def _refresh():
            nonlocal snapshots
            snapshots = self.list_snapshots()
            listbox.delete(0, tk.END)
            if not snapshots:
                listbox.insert(tk.END, "No snapshots found.")
                listbox.configure(state=tk.DISABLED)
            else:
                listbox.configure(state=tk.NORMAL)
                for s in snapshots:
                    listbox.insert(tk.END, _label_for(s))

        def _selected_snapshot() -> Optional[Dict[str, Any]]:
            if not snapshots:
                return None
            sel = listbox.curselection()
            if not sel:
                return None
            idx = sel[0]
            if idx >= len(snapshots):
                return None
            return snapshots[idx]

        def _restore_selected():
            snap = _selected_snapshot()
            if not snap:
                show_info(self.root, "Snapshots", "Select a snapshot to restore.")
                return
            if self.restore_snapshot(snap.get("path")):
                _refresh()

        def _create_snapshot():
            label = simpledialog.askstring("New Snapshot", "Optional label for this snapshot:", parent=win)
            path = self.create_snapshot(label=label)
            if path:
                show_info(self.root, "Snapshots", "Snapshot created successfully.")
                _refresh()

        _refresh()

        btn_frame = tk.Frame(frame, bg=self.bg_color)
        btn_frame.pack(fill=tk.X, pady=(6, 0))

        pack_action_button(btn_frame, "Restore", _restore_selected, role="confirm", font=FONTS["button"], side=tk.LEFT, padx=6)
        pack_action_button(btn_frame, "New Snapshot", _create_snapshot, role="save", font=FONTS["button"], side=tk.LEFT, padx=6)
        spacer = tk.Frame(btn_frame, bg=self.bg_color)
        spacer.pack(side=tk.LEFT, expand=True, fill=tk.X)
        pack_action_button(btn_frame, "Open Folder", lambda: self._open_path_in_file_manager(self._get_snapshots_dir()), role="view", font=FONTS["button"], side=tk.LEFT, padx=6)
        pack_action_button(btn_frame, "Close", win.destroy, role="cancel", font=FONTS["button"], side=tk.RIGHT, padx=6)

        listbox.bind("<Double-Button-1>", lambda e: _restore_selected())

    def _on_root_click(self, event):
        for menu, btn, close_fn in (
            (self._settings_menu, self._settings_btn, self._close_settings_menu),
            (self._files_menu, self._files_btn, self._close_files_menu),
        ):
            if not menu or not menu.winfo_exists():
                continue
            try:
                if event.widget is btn:
                    continue
                if event.widget.winfo_toplevel() == menu:
                    continue
            except Exception:
                pass
            close_fn()

    def _on_filter_change(self):
        """Auto-apply with a short debounce to avoid flicker on rapid changes."""
        try:
            if getattr(self, "_filter_apply_after_id", None):
                self.root.after_cancel(self._filter_apply_after_id)
        except Exception:
            pass
        self._filter_apply_after_id = self.root.after(80, self._apply_filters_and_refresh)

    # --- Filters slide animation helpers ---
    def _set_filters_height(self, h):
        try:
            self.filters_container.configure(height=int(max(0, h)))
        except Exception:
            pass

    def _animate_filters(self, show):
        try:
            self.root.update_idletasks()
            # Ensure container is packed when showing
            if show and not self.filters_container.winfo_ismapped():
                self.filters_container.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=(0, 6))
                self._set_filters_height(0)
            target = max(0, self.filters_frame.winfo_reqheight()) if show else 0
            cur_h = int(self.filters_container.winfo_height() or 0)
            steps = 12
            duration = 140  # ms total
            step_ms = max(10, duration // steps)
            start = cur_h
            delta = target - start

            def ease_in_out(t):
                # cubic ease-in-out 0..1
                return 4*t*t*t if t < 0.5 else 1 - pow(-2*t + 2, 3)/2

            def step(i=0):
                f = min(1.0, max(0.0, i / float(max(1, steps))))
                ef = ease_in_out(f)
                nh = int(start + delta * ef)
                self._set_filters_height(nh)
                if i < steps:
                    self.root.after(step_ms, lambda: step(i+1))
                else:
                    self._set_filters_height(target)
                    if not show:
                        # fully collapse and unmap to avoid any residual line
                        self._set_filters_height(0)
                        self.filters_container.pack_forget()
            step(0)
        except Exception:
            # Fallback: show/hide without animation
            try:
                if show:
                    if not self.filters_container.winfo_ismapped():
                        self.filters_container.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=(0, 6))
                    self._set_filters_height(self.filters_frame.winfo_reqheight())
                else:
                    self._set_filters_height(0)
                    self.filters_container.pack_forget()
            except Exception:
                pass

    def bind_mousewheel(self, widget, callback):
        """Recursively bind mousewheel to a widget and all its children"""
        if getattr(self, "_mousewheel_bound", False):
            return
        self._mousewheel_bound = True
        widget.bind_all("<MouseWheel>", callback)
        widget.bind_all("<Button-4>", callback)
        widget.bind_all("<Button-5>", callback)

    def _on_frame_configure(self, event):
        """Reset the scroll region to encompass the inner frame and adjust width"""
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        # Adjust the window width to match the canvas
        self.canvas.itemconfig(self.canvas_window, width=event.width - 40)
        # Virtualization: update visible window after geometry changes
        try:
            if getattr(self, '_virtualize_threshold', 0) and self._virtualize_threshold > 0:
                # small debounce
                try:
                    if getattr(self, '_virtual_update_after_id', None):
                        self.root.after_cancel(self._virtual_update_after_id)
                except Exception:
                    pass
                self._virtual_update_after_id = self.root.after(80, self._update_virtual_window)
        except Exception:
            pass

    def _on_mousewheel(self, event):
        try:
            y0, y1 = self.canvas.yview()
            scroll_up = (event.num == 4) or (getattr(event, "delta", 0) > 0)
            scroll_down = (event.num == 5) or (getattr(event, "delta", 0) < 0)
            if scroll_up and y0 <= 0:
                return
            if scroll_down and y1 >= 1:
                return
            if scroll_up:
                self.canvas.yview_scroll(-1, "units")
            elif scroll_down:
                self.canvas.yview_scroll(1, "units")
            # Debounced virtualization update
            try:
                if getattr(self, '_virtual_update_after_id', None):
                    self.root.after_cancel(self._virtual_update_after_id)
            except Exception:
                pass
            self._virtual_update_after_id = self.root.after(60, self._update_virtual_window)
        except Exception:
            pass

    def _increase_render_limit(self, column: str) -> None:
        try:
            current = int(self._render_limits.get(column, 200))
            self._render_limits[column] = current + 200
        except Exception:
            self._render_limits[column] = 400
        self.refresh_blocks()

    def refresh_blocks(self) -> None:
        """Clear and rebuild the blocks with dual-column sorting"""
        render_signature = self._build_render_signature()
        current_query = (self.search_var.get() or '').strip().lower() if getattr(self, 'search_var', None) else ''
        render_context = (
            render_signature,
            self._last_filter_state,
            current_query,
            tuple(sorted(self._render_limits.items())),
        )
        if self._last_render_context == render_context:
            return
        self._last_render_context = render_context

        # Reset card registry used for searching (we keep widgets for incremental updates)
        self.card_registry = []

        if not self.people_data:
            lbl = tk.Label(
                self.right_col,
                text="No people added yet. Click 'Add Candidate' to start.",
                font=FONTS["muted_bold"],
                bg=self.bg_color,
                fg="#95a5a6"
            )
            lbl.pack(pady=50)
            return


        # Build scheduled/unscheduled lists in one pass (apply filters early) using helper
        scheduled_entries: List[Tuple[datetime, str, Dict[str, Any]]] = []
        unscheduled_entries: List[Tuple[str, Dict[str, Any]]] = []
        date_cache: Dict[str, datetime] = {}

        for person in self.people_data:
            neo_date = (person.get("NEO Scheduled Date", "") or "").strip()
            is_scheduled = bool(neo_date)

            if is_scheduled and not self.filter_show_scheduled:
                continue
            if (not is_scheduled) and not self.filter_show_unscheduled:
                continue
            if not self._passes_filters(person):
                continue

            name_lower = person.get("_norm_name") or _normalize_text(person.get("Name", ""))

            if is_scheduled:
                if neo_date in date_cache:
                    date_obj = date_cache[neo_date]
                else:
                    try:
                        date_obj = datetime.strptime(neo_date, "%m/%d/%Y")
                    except Exception:
                        date_obj = datetime(9999, 12, 31)
                    date_cache[neo_date] = date_obj
                scheduled_entries.append((date_obj, name_lower, person))
            else:
                unscheduled_entries.append((name_lower, person))

        scheduled_entries.sort(key=lambda item: (item[0], item[1]))
        unscheduled_entries.sort(key=lambda item: item[0])

        # Apply render limits unless searching
        if not current_query:
            sched_limit = self._render_limits.get("scheduled", 200)
            unsched_limit = self._render_limits.get("unscheduled", 200)
            scheduled_display = scheduled_entries[:sched_limit]
            unscheduled_display = unscheduled_entries[:unsched_limit]
            sched_has_more = len(scheduled_entries) > len(scheduled_display)
            unsched_has_more = len(unscheduled_entries) > len(unscheduled_display)
        else:
            scheduled_display = scheduled_entries
            unscheduled_display = unscheduled_entries
            sched_has_more = False
            unsched_has_more = False

        # Convert entries to simple lists for synchronization helpers
        scheduled_display_persons = [p for _, _, p in scheduled_display]
        unscheduled_display_persons = [p for _, p in unscheduled_display]

        # Build index mapping to avoid O(n²) lookups
        person_to_index = {self._ensure_person_uid(person): idx for idx, person in enumerate(self.people_data)}

        # Sync columns using incremental helpers (creates/removes only necessary widgets)
        try:
            self._sync_column('unscheduled', unscheduled_display_persons, self.left_col, compact=True, has_more=unsched_has_more)
            self._sync_column('scheduled', scheduled_display_persons, self.right_col, compact=False, has_more=sched_has_more)
        except Exception:
            # Fallback to brute-force render if anything goes wrong
            for w in self.left_col.winfo_children():
                w.destroy()
            for w in self.right_col.winfo_children():
                w.destroy()
            for p in unscheduled_display_persons:
                self.create_person_block(person_to_index.get(self._ensure_person_uid(p), -1), p, self.left_col, compact=True)
            for p in scheduled_display_persons:
                self.create_person_block(person_to_index.get(self._ensure_person_uid(p), -1), p, self.right_col, compact=False)

        # Re-bind mousewheel
        self.bind_mousewheel(self.root, self._on_mousewheel)
        # Kick off virtual window update (debounced)
        try:
            if getattr(self, '_virtualize_threshold', 0) and len(self.people_data) > 0:
                self.root.after(50, self._update_virtual_window)
        except Exception:
            pass

    def create_person_block(self, index, person, parent_frame, compact=False, before_widget=None):
        """Create a person block, either compact (Name/Reqs) or detailed.

        If `before_widget` is supplied, pack the card before that widget to preserve order
        without rebuilding everything.
        Returns the created card widget.
        """
        # Create a "Card" for the person
        card = tk.Frame(parent_frame, bg=self.card_bg_color, bd=0, relief=tk.FLAT)
        # Remove internal vertical padding that created an empty area below each card
        # Keep external spacing between cards using pady only
        if before_widget is not None:
            card.pack(fill=tk.X, pady=5, before=before_widget)
        else:
            card.pack(fill=tk.X, pady=5)

        # Keep a reference by person id for incremental updates
        try:
            self._person_widgets[self._ensure_person_uid(person)] = card
        except Exception:
            pass

        # Register this card for search by name
        try:
            name_key = (person.get('_norm_name') or (person.get('Name', '') or '').strip().lower())
        except Exception:
            name_key = ''
        self.card_registry.append({
            'name': name_key,
            'widget': card
        })
        
        # Style Definitions (use shared card styles, adjust fonts per compact/detailed)
        lbl_style = self.card_lbl_style.copy()
        lbl_style["font"] = (FONTS["tiny"][0], FONTS["tiny"][1]) if compact else FONTS["small"]

        val_style = self.card_val_style.copy()
        val_style["font"] = (FONTS["tiny"][0], FONTS["tiny"][1], "bold") if compact else (FONTS["small"][0], FONTS["small"][1], "bold")

        header_val_style = self.card_accent_lbl.copy()
        header_val_style["font"] = (FONTS["body"][0], 11, "bold") if compact else FONTS["subheader"]

        accent_lbl_style = self.card_accent_small.copy()
        # Use bold at same size for category headers
        accent_lbl_style["font"] = FONTS["small_bold"]
        
        # --- HEADER ---
        header_frame = tk.Frame(card, bg=self.card_bg_color)
        header_frame.pack(fill=tk.X, padx=2 if compact else 4, pady=(2, 2) if compact else (5, 5))
        
        name_label = person.get('Name', 'Unknown').upper()
        if not compact:
            name_label = f"{name_label}    EID {person.get('Employee ID', 'N/A')}"
        
        # In compact mode, limit name width to allow buttons to be visible
        name_lbl_widget = tk.Label(header_frame, text=name_label, anchor="w", justify=tk.LEFT, **header_val_style)
        if compact:
            name_lbl_widget.config(wraplength=250)  # Allow name to wrap so buttons aren't cut off
        name_lbl_widget.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(4, 0))

        # Buttons (Edit only for compact, Full set for detailed)
        btn_frame = tk.Frame(header_frame, bg=self.card_bg_color)
        btn_frame.pack(side=tk.RIGHT)
        
        if compact:
            # compact view: Edit, Delete
            pack_action_button(btn_frame, "Edit", lambda i=index: self.open_edit_dialog(i), role="edit", font=FONTS["button"], width=BUTTON_WIDTHS['action_button'], padx=1)
            pack_action_button(btn_frame, "Delete", lambda i=index: self.delete_person(i), role="delete", font=FONTS["button"], width=BUTTON_WIDTHS['action_button'], padx=1)
        else:
            # detailed view: Archive, Edit, Delete
            pack_action_button(btn_frame, "Archive", lambda i=index: self.archive_person(i), role="archive", font=FONTS["button"], width=BUTTON_WIDTHS['action_button'], padx=1)
            pack_action_button(btn_frame, "Edit", lambda i=index: self.open_edit_dialog(i), role="edit", font=FONTS["button"], width=BUTTON_WIDTHS['action_button'], padx=1)
            pack_action_button(btn_frame, "Delete", lambda i=index: self.delete_person(i), role="delete", font=FONTS["button"], width=BUTTON_WIDTHS['action_button'], padx=1)

        # NEO Status Label (Only for Detailed Mode)
        if not compact:
            neo_date = person.get("NEO Scheduled Date", "")
            neo_lbl = build_neo_badge(header_frame, neo_date)
            neo_lbl.pack(side=tk.RIGHT, padx=20)

        # --- INFO BAR (Moved to top of block) ---
        if not compact:
            # Removed BG date from header row; keep it under Licensing & Clearances only.
            # Reordered so Branch appears after Mgr.
            info_fields = [
                ("Icims:", "ICIMS ID"),
                ("Job:", "Job Name"),
                ("Loc:", "Job Location"),
                ("Mgr:", "Manager Name"),
                ("Branch:", "Branch"),
            ]
            build_info_bar(card, person, info_fields, lbl_style, val_style)

        # --- CONTENT AREA ---
        content_box = tk.Frame(card, bg=self.card_bg_color, bd=1, relief=tk.SOLID)
        content_box.pack(fill=tk.X, padx=4 if compact else 6, pady=5)

        # Requirements Section (Compact or Detailed)
        req_frame = tk.Frame(content_box, bg=self.bg_color)
        req_frame.pack(fill=tk.X, padx=5, pady=5)
        
        tk.Label(req_frame, text=LABEL_TEXT['required_items'], font=FONTS["tiny_bold"] if compact else FONTS["small"], bg=self.bg_color, fg=TEXT_COLORS['label_dark_blue']).pack(side=tk.LEFT, padx=5)
        
        # Use list comprehension for cleaner code
        active_reqs = [label for data_key, label in REQUIRED_ITEMS if person.get(data_key)]

        # --- DYNAMIC CLEARANCES LOGIC ---
        # BG Check
        bg_date = person.get("Background Completion Date", "").strip()
        if bg_date:
            active_reqs.append("BG")
        
        # CORI (display only when cleared)
        cori_status = person.get("CORI Status", "None")
        cori_sub_date = person.get("CORI Submit Date", "").strip()
        cori_clr_date = person.get("CORI Cleared Date", "").strip()
        if cori_status == "Cleared":
            disp = "CORI Cleared"
            if cori_clr_date: disp += f": {cori_clr_date}"
            if cori_sub_date: disp += f" (Sub: {cori_sub_date})"
            active_reqs.append("CORI")

        # NH GC
        nh_status = person.get("NH GC Status", "None")
        nh_id = person.get("NH GC ID Number", "").strip()
        nh_exp = person.get("NH GC Expiration Date", "").strip()
        if nh_status == "Cleared":
            disp = f"NH GC Cleared ID:{nh_id}" if nh_id else "NH GC Cleared"
            if nh_exp: disp += f" EXP:{nh_exp}"
            active_reqs.append("NH GC")

        # ME GC
        me_status = person.get("ME GC Status", "None")
        me_sent = person.get("ME GC Sent Date", "").strip()
        if me_status == "Sent to Denise":
            disp = "ME GC Sent to Denise"
            if me_sent: disp += f" ({me_sent})"
            active_reqs.append("ME GC")

        # Others (handled elsewhere)
        
        if active_reqs:
            req_text = " • ".join(active_reqs)
            tk.Label(req_frame, text=req_text, bg=self.bg_color, fg="#3498db", font=FONTS["tiny_bold"] if compact else FONTS["tiny"], wraplength=400 if compact else 800).pack(side=tk.LEFT, padx=5)
        # Quick CORI status displayed next to Requirements (right-aligned)
        cori_state = person.get("CORI Status", "None")
        if cori_state == "Cleared":
            tk.Label(req_frame, text="CORI CLEARED", bg=self.bg_color, fg="#1a3a5a", font=FONTS["muted_bold"]).pack(side=tk.RIGHT, padx=5)

        if compact:
            # Add a bottom border and END HERE for compact
            tk.Frame(card, height=1, bg=SEPARATOR_COLOR).pack(fill=tk.X, pady=(5, 0))
            # update average compact card height for virtualization heuristics
            try:
                self.root.update_idletasks()
                h = max(1, card.winfo_height())
                # moving average update
                prev = self._avg_card_height.get('unscheduled', 60)
                self._avg_card_height['unscheduled'] = int((prev * 0.6) + (h * 0.4))
            except Exception:
                pass
            return

        # --- THREE-COLUMN DETAILED INFO ---
        details_container = tk.Frame(content_box, bg=self.card_bg_color)
        details_container.pack(fill=tk.X, padx=5, pady=5)
        
        # COLUMN 1: PERSONAL
        col1 = tk.Frame(details_container, bg=self.card_bg_color, bd=1, relief=tk.GROOVE, padx=10, pady=5)
        col1.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=3)
        
        build_section_header(col1, "Personal Info", accent_lbl_style).pack(anchor="w")
        active_id = "None"
        if person.get("State ID"): active_id = "State ID"
        elif person.get("Driver's License"): active_id = "DL"
        elif person.get("Pass Port"): active_id = "PP"
        elif person.get("Other ID"): active_id = f"Other ({person.get('Other ID')})"

        # Render Label : Value pairs using shared helper
        create_kv_row(col1, "ID Type", active_id, lbl_style, val_style, self.card_bg_color)
        create_kv_row(col1, "State", person.get("State", "N/A"), lbl_style, val_style, self.card_bg_color)
        create_kv_row(col1, "ID No.", person.get("ID No.", "N/A"), lbl_style, val_style, self.card_bg_color)
        create_kv_row(col1, "Exp", person.get("Exp.", "N/A"), lbl_style, val_style, self.card_bg_color)
        create_kv_row(col1, "DOB", person.get("DOB", "N/A"), lbl_style, val_style, self.card_bg_color)
        # Visual separator between ID details and SSN for readability
        add_separator(col1, color=SEPARATOR_COLOR, pady=PADDING['tight'])
        create_kv_row(col1, "SSN", person.get("Social", "N/A"), lbl_style, val_style, self.card_bg_color)

        # COLUMN 2: CLEARANCES
        col2 = tk.Frame(details_container, bg=self.card_bg_color, bd=1, relief=tk.GROOVE, padx=8, pady=4)
        col2.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=3)
        
        build_section_header(col2, "Licensing & Clearances", accent_lbl_style).pack(anchor="w", pady=(0, 4))
        rendered_any = False
        mvr_shown = False
        # BG row (compact label:value). Rename to "BG" as requested.
        if bg_date:
            create_kv_row(col2, "BG", bg_date, lbl_style, val_style, self.card_bg_color)
            rendered_any = True

        # MVR: show before separator; include BG date when present
        try:
            mvr_required = bool(person.get("MVR"))
        except Exception:
            mvr_required = False
        if mvr_required:
            mvr_val = "Cleared"
            if bg_date:
                mvr_val += f": {bg_date}"
            create_kv_row(col2, "MVR", mvr_val, lbl_style, val_style, self.card_bg_color)
            rendered_any = True
            mvr_shown = True

        # Build core rows: CORI / NH GC / ME GC (appear after separator)
        core_rows = []
        if cori_status == "Cleared":
            val = "Cleared"
            if cori_clr_date:
                val += f": {cori_clr_date}"
            core_rows.append(("CORI", val))

        if nh_status in ("Required", "Cleared"):
            if nh_status == "Required":
                core_rows.append(("NH GC", "Required"))
            elif nh_status == "Cleared":
                nh_val = "Cleared"
                extras = []
                if nh_id:
                    extras.append(f"ID: {nh_id}")
                if nh_exp:
                    extras.append(f"EXP: {nh_exp}")
                if extras:
                    nh_val += " — " + ", ".join(extras)
                core_rows.append(("NH GC", nh_val))

        if me_status in ("Required", "Sent to Denise"):
            if me_status == "Required":
                core_rows.append(("ME GC", "Required"))
            elif me_status == "Sent to Denise":
                me_val = "Sent to Denise"
                if me_sent:
                    me_val += f" ({me_sent})"
                core_rows.append(("ME GC", me_val))

        # Separator between BG/MVR and the rest
        if (bg_date or mvr_shown) and core_rows:
            add_separator(col2, color=SEPARATOR_COLOR, pady=PADDING['default'])

        for label_text, value_text in core_rows:
            create_kv_row(col2, label_text, value_text, lbl_style, val_style, self.card_bg_color)
            rendered_any = True

        # Additional single-flag rows (excluding MVR which is now above)
        if person.get("DOD Clearance"):
            create_kv_row(col2, "DOD", "Clearance", lbl_style, val_style, self.card_bg_color)
            rendered_any = True

        if not rendered_any:
            no_clr_style = lbl_style.copy(); no_clr_style["fg"] = "#7f8c8d"
            tk.Label(col2, text="No clearances recorded", **no_clr_style).pack(anchor="w")

        # Direct Deposit details block (render only when any value present)
        dd_bank = (person.get("Bank Name", "") or "").strip()
        rtng = (person.get("Routing Number", "") or "").strip()
        acct_num = (person.get("Account Number", "") or "").strip()
        acct_type = (person.get("Deposit Account Type", "") or "").strip()
        dd_present = bool(dd_bank or rtng or acct_num or acct_type)
        if dd_present:
            # Separator between core clearances and Direct Deposit section
            if rendered_any:
                add_separator(col2, color=SEPARATOR_COLOR, pady=PADDING['loose'])

            build_section_header(col2, "Direct Deposit Info", accent_lbl_style).pack(anchor="w", pady=(0, 5))
            if dd_bank:
                create_kv_row(col2, "Bank Name", dd_bank, lbl_style, val_style, self.card_bg_color)
            if rtng:
                create_kv_row(col2, "Rtng", rtng, lbl_style, val_style, self.card_bg_color)
            if acct_num:
                create_kv_row(col2, "Acct", acct_num, lbl_style, val_style, self.card_bg_color)
            if acct_type:
                create_kv_row(col2, "Account Type", acct_type, lbl_style, val_style, self.card_bg_color)

        # COLUMN 3: LOGISTICS
        col3 = tk.Frame(details_container, bg=self.card_bg_color, bd=1, relief=tk.GROOVE, padx=10, pady=5)
        col3.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=3)

        # Contact Info header and rows
        build_section_header(col3, "Contact Info", accent_lbl_style).pack(anchor="w")
        create_kv_row(col3, "Phone", person.get('Candidate Phone Number', 'N/A'), lbl_style, val_style, self.card_bg_color)
        create_kv_row(col3, "Email", person.get('Candidate Email', 'N/A'), lbl_style, val_style, self.card_bg_color)

        # Separator before Emergency Contact
        add_separator(col3, color=SEPARATOR_COLOR, pady=PADDING['loose'])

        # Emergency Contact section with consistent styling
        build_section_header(col3, "Emergency Contact", accent_lbl_style).pack(anchor="w")
        ec_name = f"{person.get('EC First Name','')} {person.get('EC Last Name','')}".strip()
        if ec_name:
            create_kv_row(col3, "Name", ec_name, lbl_style, val_style, self.card_bg_color)
            create_kv_row(col3, "Rel", person.get('EC Relationship',''), lbl_style, val_style, self.card_bg_color)
            create_kv_row(col3, "Phone", person.get('EC Phone Number',''), lbl_style, val_style, self.card_bg_color)
        else:
            muted = lbl_style.copy(); muted["fg"] = TEXT_COLORS['label_muted']
            tk.Label(col3, text="Not Provided", **muted).pack(anchor="w")

        # Uniform Sub-row
        build_uniform_row(col3, person, bg=self.bg_color)

        # Notes Section (lazy-expand to reduce initial widget cost)
        notes = person.get("Notes", "").strip()
        if notes:
            add_separator(card, color=SEPARATOR_COLOR, pady=PADDING['section_top'])
            toggle_frame = tk.Frame(card, bg=self.card_bg_color)
            toggle_frame.pack(fill=tk.X, padx=10 if compact else 15, pady=(4, 2))

            notes_container = {"frame": None, "expanded": False}

            def _toggle_notes():
                if notes_container["expanded"]:
                    try:
                        if notes_container["frame"] is not None:
                            notes_container["frame"].destroy()
                    except Exception:
                        pass
                    notes_container["frame"] = None
                    notes_container["expanded"] = False
                    try:
                        btn.config(text="Show Notes")
                    except Exception:
                        pass
                    return

                notes_container["expanded"] = True
                try:
                    btn.config(text="Hide Notes")
                except Exception:
                    pass
                notes_frame = tk.Frame(card, bg=self.card_bg_color, padx=10 if compact else 15, pady=5)
                notes_frame.pack(fill=tk.X, padx=10 if compact else 15, pady=5)
                tk.Label(notes_frame, text="Additional Notes:", font=FONTS["tiny_bold"], bg=self.card_bg_color, fg="#7f8c8d").pack(anchor="w")
                tk.Label(notes_frame, text=notes, font=FONTS["tiny"], bg=self.card_bg_color, wraplength=800, justify=tk.LEFT).pack(anchor="w")
                notes_container["frame"] = notes_frame

            btn = pack_action_button(toggle_frame, "Show Notes", _toggle_notes, role="charcoal", font=FONTS["tiny_bold"], width=12, side=tk.LEFT)

        # Bottom Border
        add_separator(card, color=SEPARATOR_COLOR, pady=PADDING['section_top'])

        # Update average detailed card height for virtualization heuristics
        try:
            self.root.update_idletasks()
            h = max(1, card.winfo_height())
            prev = self._avg_card_height.get('scheduled', 120)
            self._avg_card_height['scheduled'] = int((prev * 0.6) + (h * 0.4))
        except Exception:
            pass

    # --- Incremental Rendering & Background Utilities ---
    def _get_display_lists(self, current_query: str = ''):
        """Return tuple of (scheduled_persons_list, unscheduled_persons_list, sched_has_more, unsched_has_more)
        using the same filtering logic as refresh_blocks."""
        try:
            scheduled_entries: List[Tuple[datetime, str, Dict[str, Any]]] = []
            unscheduled_entries: List[Tuple[str, Dict[str, Any]]] = []
            date_cache: Dict[str, datetime] = {}

            for person in self.people_data:
                neo_date = (person.get("NEO Scheduled Date", "") or "").strip()
                is_scheduled = bool(neo_date)

                if is_scheduled and not self.filter_show_scheduled:
                    continue
                if (not is_scheduled) and not self.filter_show_unscheduled:
                    continue
                if not self._passes_filters(person):
                    continue

                name_lower = (person.get("_norm_name") or (person.get("Name", "") or "").strip().lower())

                if is_scheduled:
                    if neo_date in date_cache:
                        date_obj = date_cache[neo_date]
                    else:
                        try:
                            date_obj = datetime.strptime(neo_date, "%m/%d/%Y")
                        except Exception:
                            date_obj = datetime(9999, 12, 31)
                        date_cache[neo_date] = date_obj
                    scheduled_entries.append((date_obj, name_lower, person))
                else:
                    unscheduled_entries.append((name_lower, person))

            scheduled_entries.sort(key=lambda item: (item[0], item[1]))
            unscheduled_entries.sort(key=lambda item: item[0])

            # Apply render limits unless searching
            if not current_query:
                sched_limit = self._render_limits.get("scheduled", 200)
                unsched_limit = self._render_limits.get("unscheduled", 200)
                scheduled_display = scheduled_entries[:sched_limit]
                unscheduled_display = unscheduled_entries[:unsched_limit]
                sched_has_more = len(scheduled_entries) > len(scheduled_display)
                unsched_has_more = len(unscheduled_entries) > len(unscheduled_display)
            else:
                scheduled_display = scheduled_entries
                unscheduled_display = unscheduled_entries
                sched_has_more = False
                unsched_has_more = False

            return [p for _, _, p in scheduled_display], [p for _, p in unscheduled_display], sched_has_more, unsched_has_more
        except Exception:
            return [], [], False, False

    def _sync_after_change(self):
        """Incrementally synchronizes both columns after a small change (add/edit/delete)."""
        try:
            current_query = (self.search_var.get() or '').strip().lower() if getattr(self, 'search_var', None) else ''
            scheduled_display_persons, unscheduled_display_persons, sched_has_more, unsched_has_more = self._get_display_lists(current_query)
            self._sync_column('unscheduled', unscheduled_display_persons, self.left_col, compact=True, has_more=unsched_has_more)
            self._sync_column('scheduled', scheduled_display_persons, self.right_col, compact=False, has_more=sched_has_more)
            # Rebuild the search registry to reflect current widgets
            try:
                new_registry = []
                for p in (unscheduled_display_persons + scheduled_display_persons):
                    w = self._person_widgets.get(self._ensure_person_uid(p))
                    if w:
                        name_key = (p.get('_norm_name') or (p.get('Name', '') or '').strip().lower())
                        new_registry.append({'name': name_key, 'widget': w})
                self.card_registry = new_registry
            except Exception:
                pass
        except Exception:
            try:
                self.refresh_blocks()
            except Exception:
                pass

    def _sync_column(self, column_key: str, desired_persons: List[Dict[str, Any]], parent_frame: tk.Frame, compact: bool = False, has_more: bool = False) -> None:
        """Ensure that `parent_frame` contains widgets for `desired_persons` in the same order.
        This function creates, reorders, and removes only what is necessary, enabling incremental updates.
        """
        try:
            # Build set of desired ids
            desired_ids = [self._ensure_person_uid(p) for p in desired_persons]
            desired_set = set(desired_ids)

            # Remove any person widgets in this frame that are no longer desired
            to_remove = []
            for pid, widget in list(self._person_widgets.items()):
                try:
                    if widget is None:
                        continue
                    if widget.master is parent_frame and pid not in desired_set:
                        to_remove.append(pid)
                except Exception:
                    continue
            for pid in to_remove:
                try:
                    w = self._person_widgets.pop(pid, None)
                    if w:
                        w.destroy()
                except Exception:
                    pass

            # Ensure header exists for columns
            if column_key == 'unscheduled' and desired_persons:
                if not hasattr(self, '_left_header'):
                    self._left_header = tk.Label(self.left_col, text=LABEL_TEXT['unscheduled_section'], font=FONTS["subtext_bold"], bg=CURRENT_PALETTE["bg_color"], fg=TEXT_COLORS['section_unscheduled'])
                    self._left_header.pack(pady=(10, 5), anchor="w")
            if column_key == 'scheduled' and not hasattr(self, '_right_header'):
                self._right_header = tk.Label(self.right_col, text=LABEL_TEXT['scheduled_section'], font=FONTS["subtext_bold"], bg=CURRENT_PALETTE["bg_color"], fg=TEXT_COLORS['section_scheduled'])
                self._right_header.pack(pady=(10, 5), anchor="w")

            # Create or move widgets to match desired order
            # Build a quick map of current widgets for desired ids
            current_map = {pid: widget for pid, widget in self._person_widgets.items() if getattr(widget, 'winfo_exists', lambda: False)() and widget.master is parent_frame}

            # Find an insertion helper: the next created widget in desired order
            for i, person in enumerate(desired_persons):
                pid = self._ensure_person_uid(person)
                next_widget = None
                # find next already-created widget after i
                for j in range(i + 1, len(desired_persons)):
                    nxt_pid = id(desired_persons[j])
                    if nxt_pid in current_map:
                        next_widget = current_map[nxt_pid]
                        break
                if pid in current_map:
                    w = current_map[pid]
                    # ensure it's packed at the correct place (just before next_widget if available)
                    children = [
                        c for c in parent_frame.winfo_children()
                        if c not in (getattr(self, '_left_header', None), getattr(self, '_right_header', None))
                        and not getattr(c, '_is_load_more', False)
                    ]
                    try:
                        pos = children.index(w)
                        # if next_widget exists, ensure child at pos+1 is next_widget
                        if next_widget is not None:
                            if pos + 1 < len(children) and children[pos + 1] is next_widget:
                                pass  # already at right spot
                            else:
                                # move it
                                w.pack_forget()
                                if next_widget is not None:
                                    w.pack(fill=tk.X, pady=5, before=next_widget)
                                else:
                                    w.pack(fill=tk.X, pady=5)
                        else:
                            # ensure it's at end
                            if pos != len(children) - 1:
                                w.pack_forget()
                                w.pack(fill=tk.X, pady=5)
                    except ValueError:
                        # not present in children, pack it
                        if next_widget is not None:
                            w.pack(fill=tk.X, pady=5, before=next_widget)
                        else:
                            w.pack(fill=tk.X, pady=5)
                else:
                    # create missing widget before the next_widget (if any)
                    try:
                        before = next_widget
                    except Exception:
                        before = None
                    try:
                        idx = self.people_data.index(person)
                    except Exception:
                        idx = -1
                    self.create_person_block(idx, person, parent_frame, compact=compact, before_widget=before)

            # Manage 'Load more' button: remove any existing load more buttons then add if has_more
            for child in list(parent_frame.winfo_children()):
                try:
                    if getattr(child, '_is_load_more', False):
                        child.destroy()
                except Exception:
                    pass
            if has_more:
                btn = pack_action_button(
                    parent_frame,
                    "Load more",
                    lambda: self._increase_render_limit(column_key),
                    role="charcoal",
                    font=FONTS["small_bold"],
                    width=12,
                    padx=4,
                )
                try:
                    btn._is_load_more = True
                except Exception:
                    pass
        except Exception:
            # On failure fall back to naive rebuild
            for child in list(parent_frame.winfo_children()):
                try:
                    child.destroy()
                except Exception:
                    pass
            for person in desired_persons:
                try:
                    idx = self.people_data.index(person)
                    self.create_person_block(idx, person, parent_frame, compact=compact)
                except Exception:
                    pass

    def _remove_person_widget(self, person_id: int) -> None:
        try:
            w = self._person_widgets.pop(person_id, None)
            if w:
                w.destroy()
            # also clean card_registry entries
            self.card_registry = [e for e in self.card_registry if e.get('widget') is not w]
        except Exception:
            pass

    def _on_person_saved(self, index: Optional[int], person: Dict[str, Any]) -> None:
        # For now, synchronize both columns incrementally; future improvement: only sync affected column
        self._sync_after_change()

    # --- Background thread helpers & spinner UI ---
    def _show_spinner(self, parent, message: str = 'Loading...'):
        try:
            win = tk.Toplevel(parent)
            win.transient(parent)
            win.overrideredirect(True)
            win.attributes('-topmost', True)
            win.configure(bg='#000000')
            # Position over parent
            try:
                parent.update_idletasks()
                px = parent.winfo_rootx()
                py = parent.winfo_rooty()
                pw = parent.winfo_width()
                ph = parent.winfo_height()
                ww = 260
                wh = 80
                x = px + max(0, (pw - ww) // 2)
                y = py + max(0, (ph - wh) // 2)
                win.geometry(f"{ww}x{wh}+{x}+{y}")
            except Exception:
                pass
            frm = tk.Frame(win, bg='#ffffff', bd=1, relief=tk.RIDGE)
            frm.pack(fill=tk.BOTH, expand=True, padx=4, pady=4)
            lbl = tk.Label(frm, text=message, font=FONTS['small_bold'], bg='#ffffff')
            lbl.pack(side=tk.TOP, pady=(8, 4))
            try:
                pb = ttk.Progressbar(frm, mode='indeterminate', length=200)
                pb.pack(side=tk.TOP, pady=(0, 8))
                pb.start(10)
            except Exception:
                pb = None
            return win
        except Exception:
            return None

    def _hide_spinner(self, spinner) -> None:
        try:
            if spinner:
                spinner.destroy()
        except Exception:
            pass

    def _run_in_background(self, func, on_done=None, on_error=None):
        """Run func() in a background thread and call on_done(result) or on_error(exc) in the main thread."""
        def runner():
            try:
                res = func()
                if on_done:
                    try:
                        safe_ui_call(self.root, on_done, res)
                    except Exception as e:
                        logger.exception("WorkflowGUI: on_done callback failed: %s", e)
            except Exception as e:
                if on_error:
                    try:
                        safe_ui_call(self.root, on_error, e)
                    except Exception as e2:
                        logger.exception("WorkflowGUI: on_error callback failed: %s", e2)
        t = threading.Thread(target=runner, daemon=True)
        t.start()

    def _update_virtual_window(self):
        """Compute a reasonable visible index window and synchronize only that slice for large lists.

        This is a conservative, index-based virtualization to avoid creating thousands of widgets at once.
        """
        try:
            current_query = (self.search_var.get() or '').strip().lower() if getattr(self, 'search_var', None) else ''
            scheduled_display_persons, unscheduled_display_persons, sched_has_more, unsched_has_more = self._get_display_lists(current_query)

            # Utility to compute slice based on canvas view and average card height
            def slice_for_column(items, col_key):
                total = len(items)
                if total == 0:
                    return items, (0, 0), False
                if total <= self._virtualize_threshold:
                    return items, (0, total), False
                try:
                    y0, y1 = self.canvas.yview()
                    canvas_h = max(1, self.canvas.winfo_height())
                    avg_h = max(10, int(self._avg_card_height.get('scheduled' if col_key == 'scheduled' else 'unscheduled', 60)))
                    visible_approx = max(3, int(canvas_h / avg_h) + 4)
                    first = max(0, int(y0 * total) - 3)
                    last = min(total, first + visible_approx + 6)
                    return items[first:last], (first, last), total > last
                except Exception:
                    return items[:200], (0, min(200, total)), total > 200

            # Schedule syncs (non-blocking)
            unsched_slice, _, _ = slice_for_column(unscheduled_display_persons, 'unscheduled')
            sched_slice, _, _ = slice_for_column(scheduled_display_persons, 'scheduled')

            # Sync only visible windows or full lists depending on heuristics
            self._sync_column('unscheduled', unsched_slice, self.left_col, compact=True, has_more=unsched_has_more)
            self._sync_column('scheduled', sched_slice, self.right_col, compact=False, has_more=sched_has_more)

        except Exception:
            try:
                # fallback conservative full sync
                self._sync_after_change()
            except Exception:
                pass
    # --- Search & Scroll Helpers ---
    def search_person(self):
        """Find the first card whose name contains the query and scroll to it."""
        query = (self.search_var.get() or '').strip().lower()
        if not query:
            return
        if query != getattr(self, "search_query", "") or not getattr(self, "_search_matches", None):
            self._update_search_matches(query)
        target = self._get_current_search_target()
        if not target:
            show_info(self.root, "Not Found", f"No person found matching: {self.search_var.get()}")
            return
        # Cancel any existing highlight cycles globally before new one
        try:
            self._cancel_all_flashes()
        except Exception:
            pass
        # Also cancel any pending scheduled flash start
        try:
            if getattr(self, "_pending_flash_id", None):
                self.root.after_cancel(self._pending_flash_id)
                self._pending_flash_id = None
        except Exception:
            self._pending_flash_id = None

        # Scroll to target
        self._scroll_to_widget(target)
        # Flash highlight gently after scrolling (give a short delay so it's visible)
        def _start_flash():
            self._pending_flash_id = None
            self._flash_widget(target)
        self._pending_flash_id = self.root.after(140, _start_flash)

    def _update_search_matches(self, query):
        registry = getattr(self, 'card_registry', [])
        self._search_matches = [e.get('widget') for e in registry if query in (e.get('name') or '')]
        self._search_index = 0 if self._search_matches else -1
        self.search_query = query

    def _on_search_change(self):
        try:
            if self._search_apply_after_id:
                self.root.after_cancel(self._search_apply_after_id)
        except Exception:
            self._search_apply_after_id = None

        def _apply():
            self._search_apply_after_id = None
            query = (self.search_var.get() or '').strip().lower()
            if not query:
                self.search_query = ""
                self._search_matches = []
                self._search_index = -1
                return
            self._update_search_matches(query)

        self._search_apply_after_id = self.root.after(150, _apply)

    def _get_current_search_target(self):
        if self._search_index < 0 or not self._search_matches:
            return None
        return self._search_matches[self._search_index]

    def search_next(self):
        if not self._search_matches:
            self.search_person()
            return
        self._search_index = (self._search_index + 1) % len(self._search_matches)
        target = self._get_current_search_target()
        if target:
            self._cancel_all_flashes()
            self._scroll_to_widget(target)
            self._pending_flash_id = self.root.after(140, lambda: self._flash_widget(target))

    def search_prev(self):
        if not self._search_matches:
            self.search_person()
            return
        self._search_index = (self._search_index - 1) % len(self._search_matches)
        target = self._get_current_search_target()
        if target:
            self._cancel_all_flashes()
            self._scroll_to_widget(target)
            self._pending_flash_id = self.root.after(140, lambda: self._flash_widget(target))

    # --- Filters & Export ---
    def _apply_filters_and_refresh(self) -> None:
        """Apply current filter selections and refresh the display."""
        try:
            self.filter_branch = (self._branch_var.get() or 'All').strip()
        except (AttributeError, tk.TclError):
            self.filter_branch = 'All'
        try:
            self.filter_manager = (self._manager_var.get() or 'All').strip()
        except (AttributeError, tk.TclError):
            self.filter_manager = 'All'
        try:
            self.filter_has_bg_cleared = bool(self._bg_var.get())
            self.filter_has_cori_cleared = bool(self._cori_var.get())
            self.filter_has_nh_cleared = bool(self._nh_var.get())
            self.filter_has_me_cleared = bool(self._me_var.get())
        except (AttributeError, tk.TclError):
            pass
        try:
            self.filter_show_unscheduled = bool(self._unsched_var.get())
            self.filter_show_scheduled = bool(self._sched_var.get())
        except (AttributeError, tk.TclError):
            pass
        filter_state = (
            self.filter_branch,
            self.filter_manager,
            self.filter_has_bg_cleared,
            self.filter_has_cori_cleared,
            self.filter_has_nh_cleared,
            self.filter_has_me_cleared,
            self.filter_show_unscheduled,
            self.filter_show_scheduled,
        )
        if filter_state == self._last_filter_state:
            return
        self._last_filter_state = filter_state
        # After changing filters, do an incremental sync that respects virtualization
        try:
            self._sync_after_change()
        except Exception:
            self.refresh_blocks()

    def _passes_filters(self, person: Dict[str, Any]) -> bool:
        """Check if person passes current filter criteria."""
        # Branch filter
        if self.filter_branch != 'All':
            branch_val = person.get('_norm_branch') or (person.get('Branch', '') or '').strip().lower()
            if branch_val != self.filter_branch.strip().lower():
                return False
        # Manager filter
        if self.filter_manager != 'All':
            mgr_val = person.get('_norm_manager') or (person.get('Manager Name', '') or '').strip().lower()
            if mgr_val != self.filter_manager.strip().lower():
                return False
        # BG filter: require completion date present
        if self.filter_has_bg_cleared:
            if not (person.get('Background Completion Date', '') or '').strip():
                return False
        # CORI filter: require Cleared only
        if self.filter_has_cori_cleared:
            if (person.get('CORI Status', 'None') or 'None') != 'Cleared':
                return False
        # NH GC filter: require Cleared
        if self.filter_has_nh_cleared:
            if (person.get('NH GC Status', 'None') or 'None') != 'Cleared':
                return False
        # ME GC filter: require Sent to Denise or Cleared
        if self.filter_has_me_cleared:
            if (person.get('ME GC Status', 'None') or 'None') not in ('Sent to Denise', 'Cleared'):
                return False
        return True

    def export_current_view_csv(self):
        """Export the current filtered view to CSV."""
        import csv  # Lazy import
        if not (self.people_data or []):
            show_info(self.root, 'Export CSV', 'No people found to export.')
            return

        def person_to_row(p):
            # Base fields from config
            row = {field: p.get(field, '') for field in CSV_EXPORT_FIELDS}
            # Add computed fields
            row['Scheduled'] = 'Yes' if (p.get('NEO Scheduled Date', '') or '').strip() else 'No'
            row['MVR'] = 'Yes' if p.get('MVR') else 'No'
            row['DOD Clearance'] = 'Yes' if p.get('DOD Clearance') else 'No'
            return row

        # Build rows using current filters with list comprehensions (mirrors refresh_blocks logic)
        scheduled = [p for p in self.people_data if (p.get('NEO Scheduled Date', '') or '').strip()]
        unscheduled = [p for p in self.people_data if not (p.get('NEO Scheduled Date', '') or '').strip()]

        def get_scheduled_key(p):
            date_str = (p.get('NEO Scheduled Date', '') or '').strip()
            try:
                date_obj = datetime.strptime(date_str, '%m/%d/%Y')
            except Exception:
                date_obj = datetime(9999, 12, 31)
            return (date_obj, (p.get('Name', '') or '').strip().lower())

        scheduled.sort(key=get_scheduled_key)
        unscheduled.sort(key=lambda p: (p.get('Name', '') or '').strip().lower())

        if self.filter_show_scheduled:
            scheduled = [p for p in scheduled if self._passes_filters(p)]
        else:
            scheduled = []
        if self.filter_show_unscheduled:
            unscheduled = [p for p in unscheduled if self._passes_filters(p)]
        else:
            unscheduled = []

        rows = [person_to_row(p) for p in unscheduled] + [person_to_row(p) for p in scheduled]

        if not rows:
            show_info(self.root, 'Export CSV', 'No rows to export for current view.')
            return

        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        suffix = 'filtered'
        # Ensure exports folder exists
        ensure_dirs(self.exports_dir)
        out_path = os.path.join(self.exports_dir, f'export_{suffix}_{ts}.csv')
        try:
            with open(out_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
        except Exception as e:
            show_error(self.root, 'Export CSV', f'Failed to write CSV: {e}')
            return
        # Confirmation with quick actions
        msg = f"Exported {len(rows)} rows to:\n{out_path}"
        try:
            dlg = ExportSuccessDialog(
                self.root,
                "Export Complete",
                msg,
                on_open_location=lambda: self._open_path_in_file_manager(os.path.dirname(out_path)),
                on_view_csv=lambda: self._view_csv_file(out_path),
            )
            self.root.wait_window(dlg)
        except Exception:
            pass

    # --- Snapshot System ---
    def _get_snapshots_dir(self) -> str:
        return os.path.join(self.data_dir, 'Backups')

    def _extract_snapshot_timestamp(self, filename: str) -> Optional[datetime]:
        try:
            m = re.search(r"(\d{8}_\d{6})", filename)
            if not m:
                return None
            return datetime.strptime(m.group(1), "%Y%m%d_%H%M%S")
        except Exception:
            return None

    def list_snapshots(self) -> List[Dict[str, Any]]:
        """Return snapshot metadata sorted by newest first."""
        snapshots_dir = self._get_snapshots_dir()
        ensure_dirs(snapshots_dir)
        try:
            files = [f for f in os.listdir(snapshots_dir) if f.endswith('.enc')]
        except Exception:
            files = []
        items = []
        for fn in files:
            path = os.path.join(snapshots_dir, fn)
            try:
                stat = os.stat(path)
                ts = self._extract_snapshot_timestamp(fn)
                items.append({
                    "filename": fn,
                    "path": path,
                    "mtime": stat.st_mtime,
                    "size": stat.st_size,
                    "timestamp": ts,
                })
            except Exception:
                continue
        items.sort(key=lambda x: x.get("mtime", 0), reverse=True)
        return items

    def create_snapshot(self, label: Optional[str] = None) -> Optional[str]:
        """Create a manual snapshot from the current encrypted DB."""
        import shutil  # Lazy import
        try:
            self.save_data()
        except Exception:
            pass
        if not os.path.exists(self.enc_file):
            show_error(self.root, "Snapshot", "No encrypted database found to snapshot.")
            return None
        snapshots_dir = self._get_snapshots_dir()
        ensure_dirs(snapshots_dir)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        clean_label = (label or "").strip()
        if clean_label:
            clean_label = re.sub(r"[^a-zA-Z0-9_-]+", "_", clean_label)
            clean_label = clean_label[:40].strip("_")
        suffix = f"_{clean_label}" if clean_label else ""
        dest = os.path.join(snapshots_dir, f"snapshot_{ts}{suffix}.enc")
        try:
            shutil.copy2(self.enc_file, dest)
            return dest
        except Exception as e:
            show_error(self.root, "Snapshot", f"Failed to create snapshot:\n{e}")
            return None

    def restore_snapshot(self, snapshot_path: str, confirm: bool = True) -> bool:
        """Restore encrypted DB from a snapshot file."""
        import shutil  # Lazy import
        if not snapshot_path or not os.path.exists(snapshot_path):
            show_error(self.root, "Snapshot", "Snapshot file not found.")
            return False
        if confirm:
            msg = (
                "Restore this snapshot and overwrite your current database?\n\n"
                "This cannot be undone unless you have another snapshot."
            )
            if not ask_yes_no(self.root, "Restore Snapshot", msg):
                return False
        try:
            shutil.copy2(snapshot_path, self.enc_file)
        except Exception as e:
            show_error(self.root, "Snapshot", f"Failed to restore snapshot:\n{e}")
            return False
        try:
            self.load_data()
            self._apply_filters_and_refresh()
        except Exception:
            pass
        show_info(self.root, "Snapshot", "Snapshot restored successfully.")
        return True

    # --- Autosave & Backups ---
    def _schedule_autosave(self):
        try:
            if self._autosave_after_id:
                self.root.after_cancel(self._autosave_after_id)
        except Exception:
            pass
        try:
            interval = int(getattr(self, '_autosave_interval_ms', AUTOSAVE_INTERVAL_MS))
        except Exception:
            interval = 60_000
        self._autosave_after_id = self.root.after(interval, self._perform_autosave)

    def _perform_autosave(self):
        import shutil  # Lazy import
        try:
            self.save_data()
        except Exception:
            pass
        # Rolling backups: keep last 10 encrypted snapshots in data/Backups
        backups_dir = os.path.join(self.data_dir, 'Backups')
        ensure_dirs(backups_dir)
        # Copy encrypted file with timestamp if it exists
        if os.path.exists(self.enc_file):
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            dest = os.path.join(backups_dir, f'workflow_data_{ts}.enc')
            try:
                shutil.copy2(self.enc_file, dest)
            except Exception:
                pass
        # Prune only autosave backups; keep user-created snapshots forever
        try:
            files = []
            for fn in os.listdir(backups_dir):
                if not fn.endswith('.enc'):
                    continue
                if not fn.startswith('workflow_data_'):
                    continue
                files.append(os.path.join(backups_dir, fn))
            files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
            for old in files[10:]:
                try:
                    os.remove(old)
                except Exception:
                    pass
        except Exception:
            pass
        # Reschedule next autosave
        self._schedule_autosave()

    # --- Export helpers ---
    def _open_path_in_file_manager(self, path):
        try:
            if sys.platform.startswith('linux'):
                subprocess.Popen(['xdg-open', path])
            elif sys.platform.startswith('darwin'):
                subprocess.Popen(['open', path])
            elif sys.platform.startswith('win'):
                subprocess.Popen(['explorer', path])
            else:
                raise Exception('Unsupported platform for auto-open')
        except Exception:
            show_info(self.root, 'Open Location', f'Open this folder manually:\n{path}')

    def open_csv_viewer_dialog(self):
        """Show a picker to open CSV files in the in-app viewer."""
        ensure_dirs(self.exports_dir)
        try:
            files = [f for f in os.listdir(self.exports_dir) if f.lower().endswith('.csv')]
        except Exception:
            files = []
        if not files:
            show_info(self.root, "CSV Viewer", "No CSV files found in exports.")
            return

        files.sort(reverse=True)
        win = tk.Toplevel(self.root)
        win.title("CSV Files")
        win.configure(bg=self.bg_color)
        win.geometry("520x360")
        win.transient(self.root)
        try:
            center_window(win, self.root)
        except Exception:
            pass

        frame = tk.Frame(win, bg=self.bg_color, padx=12, pady=12)
        frame.pack(fill=tk.BOTH, expand=True)

        tk.Label(frame, text="Select a CSV file to view:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(anchor="w")

        list_frame = tk.Frame(frame, bg=self.bg_color)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=8)

        listbox = tk.Listbox(list_frame, font=FONTS["small"])
        for f in files:
            listbox.insert(tk.END, f)
        listbox.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        sb = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=listbox.yview)
        sb.pack(side=tk.RIGHT, fill=tk.Y)
        listbox.configure(yscrollcommand=sb.set)

        def _open_selected():
            sel = listbox.curselection()
            if not sel:
                return
            filename = listbox.get(sel[0])
            path = os.path.join(self.exports_dir, filename)
            try:
                self._view_csv_file(path)
            except Exception as e:
                show_error(self.root, "CSV Viewer", f"Unable to open CSV:\n{e}")

        listbox.bind("<Double-Button-1>", lambda e: _open_selected())

        btn_frame = tk.Frame(frame, bg=self.bg_color)
        btn_frame.pack(fill=tk.X, pady=(6, 0))
        pack_action_button(btn_frame, "Open", _open_selected, role="continue", font=FONTS["button"], side=tk.LEFT, padx=6)
        spacer = tk.Frame(btn_frame, bg=self.bg_color)
        spacer.pack(side=tk.LEFT, expand=True, fill=tk.X)
        pack_action_button(btn_frame, "Close", win.destroy, role="cancel", font=FONTS["button"], side=tk.RIGHT)

    def _view_csv_file(self, file_path):
        """Simple CSV viewer in-app using a Treeview with scrollbars."""
        import csv  # Lazy import
        win = tk.Toplevel(self.root)
        win.title(f"CSV Viewer: {os.path.basename(file_path)}")
        bg = self.bg_color
        win.configure(bg=bg)
        win.geometry("900x500")
        win.transient(self.root)
        try:
            center_window(win, self.root)
        except Exception:
            pass
        frame = tk.Frame(win, bg=bg)
        frame.pack(fill=tk.BOTH, expand=True, padx=10, pady=10)

        # Read CSV
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                reader = csv.reader(f)
                rows = list(reader)
        except Exception as e:
            show_error(self.root, 'CSV Viewer', f'Error reading CSV:\n{e}')
            win.destroy()
            return
        if not rows:
            show_info(self.root, 'CSV Viewer', 'CSV is empty.')
            win.destroy()
            return
        headers = rows[0]
        data_rows = rows[1:]

        # Treeview with horizontal/vertical scrollbars using grid for reliable placement
        table_frame = tk.Frame(frame, bg=bg)
        table_frame.pack(fill=tk.BOTH, expand=True)
        table_frame.grid_columnconfigure(0, weight=1)
        table_frame.grid_rowconfigure(0, weight=1)
        yscroll = tk.Scrollbar(table_frame, orient='vertical')
        xscroll = tk.Scrollbar(table_frame, orient='horizontal')
        tree = ttk.Treeview(table_frame, columns=headers, show='headings', xscrollcommand=xscroll.set, yscrollcommand=yscroll.set)
        xscroll.config(command=tree.xview)
        yscroll.config(command=tree.yview)
        tree.grid(row=0, column=0, sticky='nsew')
        yscroll.grid(row=0, column=1, sticky='ns')
        xscroll.grid(row=1, column=0, sticky='ew')

        # Enable horizontal scrolling via Shift + mouse wheel (and buttons on Linux)
        try:
            tree.bind('<Shift-MouseWheel>', lambda e: tree.xview_scroll(-1 if e.delta > 0 else 1, 'units'))
            tree.bind('<Shift-Button-4>', lambda e: tree.xview_scroll(-1, 'units'))
            tree.bind('<Shift-Button-5>', lambda e: tree.xview_scroll(1, 'units'))
        except Exception:
            pass

        # Configure headings and default column widths
        for h in headers:
            tree.heading(h, text=h)
            tree.column(h, width=140, anchor='w')

        for r in data_rows:
            # Ensure row length matches headers length
            vals = list(r) + [""] * max(0, len(headers) - len(r))
            if len(vals) > len(headers):
                vals = vals[:len(headers)]
            tree.insert('', 'end', values=vals)

        # Close button
        btn_bar = tk.Frame(win, bg=bg)
        btn_bar.pack(fill=tk.X, pady=(8, 0))
        # Open Location without closing the viewer
        try:
            pack_action_button(
                btn_bar,
                'Open File Location',
                lambda p=file_path: self._open_path_in_file_manager(os.path.dirname(p)),
                role='view',
                font=FONTS['button'],
                width=16,
                side=tk.LEFT,
                padx=6
            )
        except Exception:
            pass
        pack_action_button(btn_bar, 'Close', win.destroy, role='cancel', font=FONTS['button'], width=BUTTON_WIDTHS['action_button'], side=tk.RIGHT)

    def _scroll_to_widget(self, widget):
        """Scroll so the widget's top sits just below the header area.
        Performs a second tiny adjustment using on-screen positions to avoid overshoot.
        """
        try:
            self.canvas.update_idletasks()
            # Compute widget's Y relative to the scrollable_frame using parent chain
            def _rel_y(w, ancestor):
                y = 0
                cur = w
                while cur is not None and cur is not ancestor:
                    y += cur.winfo_y()
                    cur = cur.master
                return y

            rel_y = _rel_y(widget, self.scrollable_frame)

            total_h = max(1, self.scrollable_frame.winfo_height())
            canvas_h = max(1, self.canvas.winfo_height())
            # First pass: approximate alignment using a base offset
            offset = max(0, int(getattr(self, "_scroll_top_offset", SCROLL_TOP_OFFSET)))
            target_top = max(0, rel_y - offset)
            max_scroll = max(1, total_h - canvas_h)
            fraction = 0.0 if max_scroll <= 1 else min(1.0, max(0.0, target_top / max_scroll))
            self.canvas.yview_moveto(fraction)

            # Second pass: measure actual on-screen delta and correct to desired margin
            def _fine_align():
                try:
                    self.canvas.update_idletasks()
                    # Current top in pixels within scrollregion
                    vy0 = self.canvas.yview()[0]
                    cur_top = vy0 * max_scroll
                    # Compute delta between widget top and canvas top on screen
                    widget_y_screen = widget.winfo_rooty()
                    canvas_y_screen = self.canvas.winfo_rooty()
                    delta = widget_y_screen - canvas_y_screen
                    desired = max(0, int(getattr(self, "_scroll_view_margin", SCROLL_VIEW_MARGIN)))
                    adjust = delta - desired
                    if abs(adjust) > 1:
                        new_top = max(0, min(max_scroll, int(cur_top + adjust)))
                        new_frac = 0.0 if max_scroll <= 1 else new_top / max_scroll
                        self.canvas.yview_moveto(new_frac)
                except Exception:
                    pass
            # Apply the fine alignment shortly after the first move
            self.root.after(1, _fine_align)
        except Exception:
            # As a fallback, try a minimal scroll into view
            self.canvas.yview_scroll(1, 'units')

    def _cancel_flash_for(self, root_widget, restore=True):
        """Cancel active flash for a specific root widget and optionally restore colors."""
        state = self._flash_states.pop(root_widget, None)
        if not state:
            return
        # Cancel all scheduled callbacks
        for aid in state.get("after_ids", []):
            try:
                self.root.after_cancel(aid)
            except Exception:
                pass
        if restore:
            for w, orig in state.get("nodes", []):
                try:
                    w.configure(bg=orig)
                except Exception:
                    pass

    def _cancel_all_flashes(self):
        """Cancel all active highlight flashes and restore colors."""
        for w in list(self._flash_states.keys()):
            self._cancel_flash_for(w, restore=True)

    def _flash_widget(self, root_widget, highlight=None, hold_ms=None, fade_ms=None, fade_steps=None):
        """Gentle highlight: one-time highlight, hold for ~1s, then fade out ~1s.
        Robust against rapid re-triggers and restores original colors.
        """
        if highlight is None:
            highlight = FLASH_COLORS['highlight']
        if hold_ms is None:
            hold_ms = FLASH_COLORS['hold_ms']
        if fade_ms is None:
            fade_ms = FLASH_COLORS['fade_ms']
        if fade_steps is None:
            fade_steps = FLASH_COLORS['fade_steps']
        # Clear any pending start marker
        self._pending_flash_id = None

        # If this widget is already flashing, cancel and restore first
        self._cancel_flash_for(root_widget, restore=True)

        # Collect colorable widgets and their original bg colors (snapshot)
        nodes = []
        def dfs(w):
            try:
                orig = w.cget("bg")
                nodes.append((w, orig))
            except Exception:
                pass
            for c in w.winfo_children():
                dfs(c)
        dfs(root_widget)

        # Create state for this flash session
        self._flash_counter = getattr(self, "_flash_counter", 0) + 1
        session_id = self._flash_counter
        state = {"nodes": nodes, "after_ids": [], "session": session_id}
        self._flash_states[root_widget] = state

        # Helpers for color handling
        def _hex_to_rgb(h):
            try:
                h = h.strip()
                if h.startswith('#'):
                    h = h[1:]
                if len(h) == 6:
                    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
            except Exception:
                pass
            return None

        def _rgb_to_hex(rgb):
            try:
                r, g, b = rgb
                return f"#{r:02x}{g:02x}{b:02x}"
            except Exception:
                return None

        def _blend(c1, c2, t):
            """Blend from c1 (start) to c2 (end) by fraction t in [0,1]."""
            return (
                int(c1[0] + (c2[0] - c1[0]) * t),
                int(c1[1] + (c2[1] - c1[1]) * t),
                int(c1[2] + (c2[2] - c1[2]) * t),
            )

        # Precompute highlight rgb
        hl_rgb = _hex_to_rgb(highlight) or (255, 243, 191)  # default for #fff3bf

        def set_bg(color):
            for w, _ in state["nodes"]:
                try:
                    w.configure(bg=color)
                except Exception:
                    pass

        def restore():
            for w, orig in state["nodes"]:
                try:
                    w.configure(bg=orig)
                except Exception:
                    pass

        def schedule(fn, delay):
            aid = self.root.after(delay, fn)
            state["after_ids"].append(aid)
            return aid

        def end():
            # Restore colors and cancel any still-pending callbacks for this session
            restore()
            for aid in list(state.get("after_ids", [])):
                try:
                    self.root.after_cancel(aid)
                except Exception:
                    pass
            # Clear state
            self._flash_states.pop(root_widget, None)

        # Step 1: Apply highlight immediately and hold
        set_bg(highlight)

        # Step 2: Fade out from highlight to each node's original color
        step_interval = max(10, int(fade_ms / max(1, fade_steps)))

        # Prepare per-node original RGBs (may be None for non-hex colors)
        orig_rgbs = []
        for w, orig in state["nodes"]:
            orig_rgbs.append(_hex_to_rgb(orig))

        def fade_step(i):
            # If a new session replaced this, stop
            if self._flash_states.get(root_widget) is not state:
                return
            t = min(1.0, max(0.0, i / float(max(1, fade_steps))))
            # Compute and set blended color for each node
            for (w, orig), o_rgb in zip(state["nodes"], orig_rgbs):
                try:
                    if o_rgb is None:
                        # Can't fade; set original at final step
                        if i >= fade_steps:
                            w.configure(bg=orig)
                        else:
                            w.configure(bg=highlight)
                    else:
                        blended = _blend(hl_rgb, o_rgb, t)
                        color = _rgb_to_hex(blended)
                        if color:
                            w.configure(bg=color)
                except Exception:
                    pass
            if i < fade_steps:
                schedule(lambda: fade_step(i+1), step_interval)
            else:
                end()

        # Schedule start of fade after hold period
        schedule(lambda: fade_step(0), hold_ms)

        # Absolute safety restore (in case of interruptions)
        schedule(lambda: (self._flash_states.get(root_widget) is state) and end(), max(hold_ms + fade_ms + 1000, 5000))

    def open_add_dialog(self):
        self.show_person_dialog()
        
    def open_archive_viewer(self):
        """Launches the archive browser without prompting; password is asked on access."""
        ArchiveViewer(self.root, self.archive_dir, owner_gui=self)

    def _ensure_pyzipper(self) -> bool:
        """Ensure pyzipper is installed (synchronous)."""
        try:
            import pyzipper  # type: ignore
            _ = pyzipper.__version__
            return True
        except Exception:
            pass
        try:
            cmd = [sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "pyzipper"]
            result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
            if result.returncode != 0:
                return False
            import pyzipper  # type: ignore
            _ = pyzipper.__version__
            return True
        except Exception:
            return False
    
    def open_weekly_tracker(self):
        """Launch the Weekly Tracker in a new window."""
        try:
            WeeklyTrackerGUI(self.root, self.data_dir)
        except Exception as e:
            show_error(self.root, 'Weekly Tracker', f'Failed to open Weekly Tracker:\n{e}')
        
    def open_edit_dialog(self, index):
        person = self.people_data[index]
        self.show_person_dialog(person, index)

    def change_program_password(self):
        # Simplified flow: instruct user to remove the program auth file to reset password.
        try:
            auth_path = os.path.relpath(self.auth_file, start=os.path.dirname(os.path.abspath(__file__)))
        except Exception:
            auth_path = self.auth_file

        message = (
            "To reset the program password, delete the program auth file:\n\n"
            f"{auth_path}\n\n"
            "Removing this file will cause the application to prompt for a new master password on next start.\n"
            "If you need assistance, please back up your data directory before deleting."
        )
        show_info(self.root, "Reset Program Password", message)

    def delete_person(self, index):
        if ask_yes_no(self.root, "Confirm Delete", f"Are you sure you want to delete {self.people_data[index].get('Name', 'this person')}?"):
            try:
                pid = self._ensure_person_uid(self.people_data[index])
            except Exception:
                pid = None
            self.people_data.pop(index)
            self.save_data()
            # Remove widget for deleted person and sync visible columns
            try:
                if pid is not None:
                    self._remove_person_widget(pid)
            except Exception:
                pass
            try:
                self._sync_after_change()
            except Exception:
                self.refresh_blocks()

    def _calculate_neo_hours(self, start_time: str, end_time: str) -> str:
        """Calculate NEO hours from time strings in HHMM format."""
        try:
            if not start_time or not end_time:
                return "N/A"
            start_str = (start_time or '').strip().replace(':', '')
            end_str = (end_time or '').strip().replace(':', '')
            if not start_str or not end_str:
                return "N/A"
            if len(start_str) < 4 or len(end_str) < 4:
                return "N/A"
            start_mins = int(start_str[:2]) * 60 + int(start_str[2:4])
            end_mins = int(end_str[:2]) * 60 + int(end_str[2:4])
            if end_mins < start_mins:
                end_mins += 24 * 60
            total_mins = end_mins - start_mins
            hours = total_mins // 60
            mins = total_mins % 60
            return f"{hours}h {mins}m" if mins else f"{hours}h"
        except (ValueError, IndexError):
            return "N/A"

    def _parse_archive_date(self, neo_date_str: str) -> tuple:
        """Parse NEO date and return (year, month) as integers.
        Raises ValueError if invalid.
        """
        if not neo_date_str:
            raise ValueError("Missing NEO date")
        parts = neo_date_str.strip().split('/')
        if len(parts) < 3:
            raise ValueError("Invalid NEO date format")
        mm = int(parts[0])
        yyyy = int(parts[2])
        if mm < 1 or mm > 12 or yyyy < 1900:
            raise ValueError("Invalid NEO date values")
        return yyyy, mm

    def _build_archive_text(self, person: dict, start_time: str, end_time: str, total_hours: str) -> str:
        """Build formatted archive text content."""
        req_name = person.get("Name", "Unknown")
        req_eid = person.get("Employee ID", "N/A")
        req_neo = person.get("NEO Scheduled Date", "N/A")
        now = datetime.now()

        # Build archive text using a single list definition
        parts = [
            f"FILE ARCHIVED: {now.strftime('%m-%d-%Y %H%M')}",
            "",
            f"== {ARCHIVE_SECTIONS['candidate_info']} ==",
            f"Name: {req_name}",
            f"Employee ID: {req_eid}",
            f"Hire Date (NEO): {req_neo}",
            f"Job Name: {person.get('Job Name', 'N/A')}",
            f"Job Location: {person.get('Job Location', 'N/A')}",
            f"Branch: {person.get('Branch', 'N/A')}",
            "",
            f"== {ARCHIVE_SECTIONS['neo_hours']} ==",
            f"Start: {start_time if start_time else 'N/A'}",
            f"End:   {end_time if end_time else 'N/A'}",
            f"Total Hours: {total_hours}",
            "",
            f"== {ARCHIVE_SECTIONS['uniform_sizes']} ==",
            f"Shirt: {person.get('Shirt Size', 'N/A')}",
            f"Pants: {person.get('Pants Size', 'N/A')}",
            f"Boots: {person.get('Boots Size', 'N/A')}",
            "",
        ]

        notes_text = (person.get('Notes') or '').strip()
        if notes_text:
            parts.extend([
                f"== {ARCHIVE_SECTIONS['notes']} ==",
                *[line.rstrip() for line in notes_text.splitlines()],
                "",
            ])

        parts.append("-" * 40)
        return "\n".join(parts)

    def archive_person(self, index):
        """Create a password-protected ZIP archive for a person."""
        person = self.people_data[index]
        
        # Validation for Required Fields
        req_name = person.get("Name", "").strip()
        req_eid = person.get("Employee ID", "").strip()
        req_neo = person.get("NEO Scheduled Date", "").strip()

        if not all([req_name, req_eid, req_neo]):
            show_error(self.root, "Error", "Cannot archive! Make sure Name, Employee ID, and NEO Scheduled Date are filled.")
            return

        if not ask_yes_no(self.root, "Confirm Archive", f"Archive {req_name} and remove from active list?"):
            return

        try:
            try:
                import pyzipper  # type: ignore
            except Exception:
                if not self._ensure_pyzipper():
                    show_error(self.root, "Archive Failure", "pyzipper is required to apply passwords to archives.")
                    return
                import pyzipper  # type: ignore

            # Prompt for archive password
            now = datetime.now()
            try:
                year, month = self._parse_archive_date(req_neo)
                month_str = f"{year}_{int(month):02d}"
            except Exception:
                show_error(self.root, "Error", "Cannot archive! NEO Scheduled Date is invalid or missing.")
                return
            archive_file = f"{month_str}.zip"
            archive_full = os.path.join(self.archive_dir, archive_file)
            prompt = f"Set password for {req_name}'s archive:" if not os.path.exists(archive_full) else f"Enter password for {archive_file}:"
            arch_dialog = ArchivePasswordDialog(self.root, prompt=prompt, default="")
            self.root.wait_window(arch_dialog)
            if not arch_dialog.result:
                return
            archive_password = arch_dialog.result

            # Prompt for NEO hours using custom dialog
            neo_dialog = NEOTimeDialog(self.root, req_name)
            self.root.wait_window(neo_dialog)
            if not neo_dialog.result:
                return  # User cancelled
            start_time, end_time = neo_dialog.result
            total_hours = self._calculate_neo_hours(start_time, end_time)

            # Build archive content
            file_body = self._build_archive_text(person, start_time, end_time, total_hours)

            # Create monthly archive filename (YYYY-MM format)
            clean_name = re.sub(r'[^a-zA-Z0-9]', '_', req_name)
            month_folder = month_str
            
            # Create password-protected ZIP file
            ensure_dirs(self.archive_dir)

            readme_name = "README.txt"
            temp_archive = None

            def _count_people(entries: set) -> int:
                prefix = f"{month_folder}/"
                return sum(1 for name in entries if name.startswith(prefix) and name.lower().endswith(".txt"))

            def _read_created_date(text: str, fallback: str) -> str:
                for line in text.splitlines():
                    if line.lower().startswith("archive created:"):
                        value = line.split(":", 1)[1].strip()
                        return value or fallback
                return fallback

            created_date = now.strftime("%Y-%m-%d")

            try:
                if os.path.exists(archive_full):
                    tmp_handle = tempfile.NamedTemporaryFile(delete=False, dir=os.path.dirname(archive_full), suffix=".tmp")
                    temp_archive = tmp_handle.name
                    tmp_handle.close()
                    with pyzipper.AESZipFile(archive_full, 'r') as zf_in:
                        zf_in.setpassword(archive_password.encode('utf-8'))
                        existing = set(zf_in.namelist())
                        arcname = f"{month_folder}/{clean_name}.txt"
                        if arcname in existing:
                            counter = 2
                            while True:
                                candidate = f"{month_folder}/{clean_name}_{counter}.txt"
                                if candidate not in existing:
                                    arcname = candidate
                                    break
                                counter += 1

                        if readme_name in existing:
                            try:
                                existing_text = zf_in.read(readme_name).decode('utf-8', errors='replace')
                                created_date = _read_created_date(existing_text, created_date)
                            except Exception:
                                pass

                        updated_entries = set(existing)
                        updated_entries.add(arcname)
                        people_count = _count_people(updated_entries)

                        readme_text = "\n".join([
                            "Workflow Archive",
                            f"Program Version: {APP_VERSION}",
                            f"Archive Created: {created_date}",
                            f"Last Updated: {now.strftime('%Y-%m-%d')}",
                            f"People in Archive: {people_count}",
                            "",
                            "Contents:",
                            "This archive contains exported candidate records from the Workflow program.",
                            "Use common sense when handling sensitive PII. Keep files secure, share only with authorized staff,",
                            "and delete when no longer needed.",
                        ])

                        with pyzipper.AESZipFile(
                            temp_archive,
                            'w',
                            compression=pyzipper.ZIP_DEFLATED,
                            encryption=pyzipper.WZ_AES,
                        ) as zf_out:
                            zf_out.setpassword(archive_password.encode('utf-8'))
                            zf_out.setencryption(pyzipper.WZ_AES, nbits=256)
                            for name in existing:
                                if name == readme_name:
                                    continue
                                data = zf_in.read(name)
                                zf_out.writestr(name, data)
                            zf_out.writestr(arcname, file_body)
                            zf_out.writestr(readme_name, readme_text)

                    os.replace(temp_archive, archive_full)
                else:
                    tmp_handle = tempfile.NamedTemporaryFile(delete=False, dir=os.path.dirname(archive_full), suffix=".tmp")
                    temp_archive = tmp_handle.name
                    tmp_handle.close()
                    arcname = f"{month_folder}/{clean_name}.txt"
                    people_count = 1
                    readme_text = "\n".join([
                        "Workflow Archive",
                        f"Program Version: {APP_VERSION}",
                        f"Archive Created: {created_date}",
                        f"Last Updated: {now.strftime('%Y-%m-%d')}",
                        f"People in Archive: {people_count}",
                        "",
                        "Contents:",
                        "This archive contains exported candidate records from the Workflow program.",
                        "Use common sense when handling sensitive PII. Keep files secure, share only with authorized staff,",
                        "and delete when no longer needed.",
                    ])

                    with pyzipper.AESZipFile(
                        temp_archive,
                        'w',
                        compression=pyzipper.ZIP_DEFLATED,
                        encryption=pyzipper.WZ_AES,
                    ) as zf_out:
                        zf_out.setpassword(archive_password.encode('utf-8'))
                        zf_out.setencryption(pyzipper.WZ_AES, nbits=256)
                        zf_out.writestr(arcname, file_body)
                        zf_out.writestr(readme_name, readme_text)
                    os.replace(temp_archive, archive_full)
            except Exception:
                try:
                    if temp_archive and os.path.exists(temp_archive):
                        os.remove(temp_archive)
                except Exception:
                    pass
                raise
            
            # Remove from active list (ensure widget removed immediately)
            try:
                removed_pid = self._ensure_person_uid(person)
            except Exception:
                removed_pid = None
            self.people_data.pop(index)
            self.save_data()
            try:
                if removed_pid is not None:
                    self._remove_person_widget(removed_pid)
                # Incremental UI sync
                self._sync_after_change()
            except Exception:
                self.refresh_blocks()

            archive_dir = os.path.dirname(archive_full)
            success_dialog = ArchiveSuccessDialog(
                self.root,
                archive_full,
                on_open_location=lambda: self._open_path_in_file_manager(archive_dir),
            )
            self.root.wait_window(success_dialog)

        except Exception as e:
            show_error(self.root, "Archive Failure", f"Error archiving: {str(e)}")

    def show_person_dialog(self, person=None, index=None):
        dialog = tk.Toplevel(self.root)
        dialog.title("Edit Person" if person else "Add Person")
        dialog.configure(bg=self.bg_color)
        dialog.resizable(False, False) # Non-resizable as requested
        dialog.transient(self.root)
        dialog.withdraw()  # Hide until layout is complete
        
        entries = {}
        checkbox_vars = {}
        branch_var = tk.StringVar(value=person.get("Branch", BRANCH_OPTIONS[1]) if person else BRANCH_OPTIONS[1])

        # Canonicalize saved/edit values to allowed options per field
        def _canonicalize(field, val):
            t = (val or '').strip()
            def norm(s):
                return ''.join(ch for ch in s.lower() if ch.isalnum())
            n = norm(t)
            if field in STATUS_FIELDS:
                # Common status tokens
                if 'req' in n:
                    return STATUS_REQUIRED
                if 'sub' in n:
                    return STATUS_SUBMITTED if field == 'CORI Status' else (STATUS_REQUIRED if 'sub' in n else STATUS_NONE)
                if 'clear' in n or 'clr' in n:
                    return STATUS_CLEARED
                if field == 'ME GC Status' and ('sent' in n and 'denise' in n or 'senttodenise' in n):
                    return STATUS_SENT_TO_DENISE
                if 'none' in n or t == '':
                    return STATUS_NONE
                # Fallback: return original (might already be valid)
                return t
            if field == 'Deposit Account Type':
                if 'saving' in n:
                    return 'Savings'
                if 'check' in n:
                    return 'Checking'
                return '' if t == '' else t
            if field == 'Shirt Size':
                sizes = [disp for disp, _ in CODE_MAPS.get('Shirt Size', [])]
                for s in sizes:
                    if norm(s) == n:
                        return s
                return t or 'MD'
            return t

        # --- Invisible index codes for robust persistence ---
        code_maps = CODE_MAPS
        def _code_from_display(field, display):
            pairs = code_maps.get(field, [])
            for disp, c in pairs:
                if (display or '').strip().lower() == disp.lower():
                    return c
            return ''
        # Store combobox widgets and maps for saving codes
        combo_code_widgets = {}
        
        # Create canvas with scrollbar for the main content
        canvas = tk.Canvas(dialog, bg=self.bg_color, highlightthickness=0)
        scrollbar = ttk.Scrollbar(dialog, orient=tk.VERTICAL, command=canvas.yview)
        scrollable_frame = tk.Frame(canvas, bg=self.bg_color)
        
        # Bind to update scrollregion when frame changes
        scrollable_frame.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        scroll_window_id = canvas.create_window((0, 0), window=scrollable_frame, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)
        
        # Enable mousewheel scrolling
        def on_mousewheel(event):
            try:
                if not canvas.winfo_exists():
                    return
                delta = event.delta
                if delta == 0:
                    return
                canvas.yview_scroll(int(-1 * (delta / 120)), "units")
            except Exception:
                pass

        def on_mousewheel_linux(event):
            try:
                if not canvas.winfo_exists():
                    return
                if event.num == 4:
                    canvas.yview_scroll(-1, "units")
                elif event.num == 5:
                    canvas.yview_scroll(1, "units")
            except Exception:
                pass

        def on_mousewheel_dialog(event):
            try:
                if event.widget.winfo_toplevel() is not dialog:
                    return
                if not canvas.winfo_exists():
                    return "break"
                delta = getattr(event, "delta", 0)
                if delta:
                    canvas.yview_scroll(int(-1 * (delta / 120)), "units")
                    return "break"
            except Exception:
                return "break"

        def on_mousewheel_dialog_linux(event):
            try:
                if event.widget.winfo_toplevel() is not dialog:
                    return
                if not canvas.winfo_exists():
                    return "break"
                if event.num == 4:
                    canvas.yview_scroll(-1, "units")
                elif event.num == 5:
                    canvas.yview_scroll(1, "units")
                return "break"
            except Exception:
                return "break"

        canvas.bind("<MouseWheel>", on_mousewheel)
        canvas.bind("<Button-4>", on_mousewheel_linux)
        canvas.bind("<Button-5>", on_mousewheel_linux)
        dialog.bind_all("<MouseWheel>", on_mousewheel_dialog, add="+")
        dialog.bind_all("<Button-4>", on_mousewheel_dialog_linux, add="+")
        dialog.bind_all("<Button-5>", on_mousewheel_dialog_linux, add="+")
        
        # Pack canvas and scrollbar (expands to fill space above buttons)
        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        
        # Content inside scrollable frame
        content_frame = tk.Frame(scrollable_frame, bg=self.bg_color)
        content_frame.pack(fill=tk.BOTH, expand=True, padx=25, pady=20)
        
        # (Header row removed per layout change)

        # Main Layout Container
        main_form = tk.Frame(content_frame, bg=self.bg_color)
        main_form.pack(fill=tk.BOTH, expand=True)
        
        # Button frame will be added at the end of content_frame (inside scrollable area)
        footer_frame = None
        
        # --- LEFT COLUMN ---
        left_col = tk.Frame(main_form, bg=self.bg_color)
        left_col.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 20), anchor="n")
        left_col.columnconfigure(0, weight=1)
        
        # Basic Information Section
        basic_lframe = tk.LabelFrame(
            left_col, 
            text=DIALOG_SECTIONS['basic_info'], 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        basic_lframe.grid(row=0, column=0, sticky="nsew", pady=(0, 10))
        basic_lframe.columnconfigure(1, weight=1)

        self._build_entry_fields(basic_lframe, BASIC_INFO_FIELDS, entries, person, label_col=0, entry_col=1)

        # Branch radio buttons (Inside Basic Info)
        tk.Label(basic_lframe, text=DIALOG_FIELD_LABELS['branch'], bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).grid(row=7, column=0, sticky="w", pady=5)
        branch_frame = tk.Frame(basic_lframe, bg=self.bg_color)
        branch_frame.grid(row=7, column=1, sticky="w", padx=(10, 0), pady=5)
        
        branch_var = tk.StringVar(value=person.get("Branch", BRANCH_OPTIONS[1]) if person else BRANCH_OPTIONS[1])
        entries["Branch_var"] = branch_var
        for branch in BRANCH_OPTIONS[1:]:
            self._create_radiobutton(branch_frame, branch, branch_var, branch)

        # Contact Info Section
        contact_lframe = tk.LabelFrame(
            left_col, 
            text=DIALOG_SECTIONS['contact_info'], 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        contact_lframe.grid(row=1, column=0, sticky="nsew", pady=(0, 10))
        contact_lframe.columnconfigure(1, weight=1)
        contact_lframe.columnconfigure(3, weight=3) # Allow email to take more space

        phone_entry = self._label_and_entry(contact_lframe, "Phone", 0, label_col=0, entry_col=1)
        phone_entry.config(width=WIDGET_WIDTHS['form_entry_large'])
        if person and "Candidate Phone Number" in person:
            phone_entry.insert(0, person["Candidate Phone Number"])
        entries["Candidate Phone Number"] = phone_entry

        email_entry = self._label_and_entry(contact_lframe, "Email", 0, label_col=2, entry_col=3)
        if person and "Candidate Email" in person:
            email_entry.insert(0, person["Candidate Email"])
        entries["Candidate Email"] = email_entry

        # --- PERSONAL INFO SECTION ---
        personal_lframe = tk.LabelFrame(
            left_col, 
            text=DIALOG_SECTIONS['personal_info'], 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        personal_lframe.grid(row=2, column=0, sticky="nsew") # Row 2 in left_col
        personal_lframe.columnconfigure(4, weight=1)

        # Row 0: ID Type Checkboxes + Other (Now at top of this section)
        id_checks_frame = tk.Frame(personal_lframe, bg=self.bg_color)
        id_checks_frame.grid(row=0, column=0, columnspan=5, sticky="w", pady=5)

        id_types = [("State ID", "State ID"), ("DL", "Driver's License"), ("PP", "Pass Port")]
        for i, (text, key) in enumerate(id_types): # Changed id_checks to id_types as per original code
            var = tk.BooleanVar(value=person.get(key, False) if person else False)
            checkbox_vars[key] = var
            cb = tk.Checkbutton(id_checks_frame, text=text, variable=var, bg=self.bg_color, fg=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), activebackground=self.bg_color, activeforeground=self.fg_color, font=FONTS["small"])
            cb.pack(side=tk.LEFT, padx=(0, 5))
        
        tk.Label(id_checks_frame, text="Other:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(5, 5))
        other_entry = tk.Entry(id_checks_frame, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color, width=WIDGET_WIDTHS['form_entry_large'])
        other_entry.pack(side=tk.LEFT)
        if person and "Other ID" in person:
            other_entry.insert(0, person["Other ID"])
        entries["Other ID"] = other_entry

        # Row 2: Basic Identity Fields
        for i, field in enumerate(PERSONAL_ID_FIELDS):
            tk.Label(personal_lframe, text=field + ":", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).grid(row=i+1, column=0, sticky="w", pady=5)
            entry = tk.Entry(personal_lframe, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
            entry.grid(row=i+1, column=1, columnspan=4, sticky="ew", padx=(5, 0), pady=5)
            if person and field in person:
                entry.insert(0, person[field])
            entries[field] = entry

        # --- RIGHT COLUMN ---
        right_col = tk.Frame(main_form, bg=self.bg_color)
        right_col.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, anchor="n")
        right_col.columnconfigure(0, weight=1)

        # Apply stylesheet-driven palette to the dialog using the current theme
        try:
            refs = {
                'container': content_frame,
                'scrollable_frame': main_form,
                'left_col': left_col,
                'right_col': right_col,
            }
            pal = get_palette(getattr(self, '_current_theme', 'light'))
            apply_palette(dialog, pal, refs)
            # Set lighter sky-blue header color for early-created label frames
            try:
                is_dark = _is_dark_color(pal.get('bg_color', '#000000'))
                header_fg = pal.get('header_fg_color', '#4ea0ff' if is_dark else '#87CEEB')
                for lf in (
                    basic_lframe,
                    contact_lframe,
                    personal_lframe,
                ):
                    try:
                        lf.configure(fg=header_fg)
                    except Exception:
                        pass
            except Exception:
                pass
            # Ensure readable text colors across the dialog
            apply_text_contrast(content_frame)
            apply_text_contrast(main_form)
            apply_text_contrast(left_col)
            apply_text_contrast(right_col)
        except Exception:
            pass
        
        # Licensing Section (Moved to row 1)
        license_lframe = tk.LabelFrame(
            right_col, 
            text=DIALOG_SECTIONS['license_clearance'], 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        license_lframe.grid(row=1, column=0, sticky="nsew", pady=(0, 10))
        license_lframe.columnconfigure(1, weight=1)
        
        # Remove "CORI Submitted or Cleared Date" from lic_fields
        self._build_entry_fields(license_lframe, LICENSE_FIELDS, entries, person, label_col=0, entry_col=1)

        # --- EMERGENCY CONTACT SECTION ---
        emergency_lframe = tk.LabelFrame(
            right_col, 
            text=DIALOG_SECTIONS['emergency_contact'], 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        emergency_lframe.grid(row=0, column=0, sticky="nsew", pady=(0, 10))
        emergency_lframe.columnconfigure(1, weight=1)

        self._build_entry_fields(emergency_lframe, EMERGENCY_CONTACT_FIELDS, entries, person, label_col=0, entry_col=1)

        # --- CLEARANCES SECTION (In Right Column) ---
        status_lframe = tk.LabelFrame(
            right_col, 
            text=DIALOG_SECTIONS['clearances'], 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        status_lframe.grid(row=1, column=0, sticky="nsew", pady=(0, 8))
        status_lframe.columnconfigure(1, weight=1)
        
        # BG Date + inline MVR and DOD checkboxes
        tk.Label(status_lframe, text=DIALOG_FIELD_LABELS['bg_date'], bg=self.bg_color, font=FONTS["tiny_bold"]).grid(row=0, column=0, sticky="w", pady=5)
        bg_row = tk.Frame(status_lframe, bg=self.bg_color)
        bg_row.grid(row=0, column=1, sticky="w", padx=5)
        bg_entry = tk.Entry(bg_row, font=FONTS["small"], width=10, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        bg_entry.pack(side=tk.LEFT)
        if person: bg_entry.insert(0, person.get("Background Completion Date", ""))
        entries["Background Completion Date"] = bg_entry
        # MVR and DOD inline next to BG date
        mvr_var = tk.BooleanVar(value=person.get("MVR", False) if person else False)
        checkbox_vars["MVR"] = mvr_var
        self._create_checkbox(bg_row, CLEARANCE_LABELS['mvr'], mvr_var, font="tiny", padx=(8, 0))
        dod_var = tk.BooleanVar(value=person.get("DOD Clearance", False) if person else False)
        checkbox_vars["DOD Clearance"] = dod_var
        self._create_checkbox(bg_row, CLEARANCE_LABELS['dod'], dod_var, font="tiny", padx=(8, 0))

        tk.Frame(status_lframe, height=1, bg="#bdc3c7").grid(row=1, column=0, columnspan=2, sticky="ew", pady=5)

        # CORI Section (checkboxes)
        tk.Label(status_lframe, text=DIALOG_FIELD_LABELS['cori'], bg=self.bg_color, font=FONTS["small"]).grid(row=2, column=0, sticky="w")
        cori_opts = tk.Frame(status_lframe, bg=self.bg_color)
        cori_opts.grid(row=2, column=1, sticky="w")
        cori_req_var = tk.BooleanVar(value=(person.get("CORI Required", False) if person else False) or ((person.get("CORI Status", STATUS_NONE) if person else STATUS_NONE) == STATUS_REQUIRED))
        cori_sub_var = tk.BooleanVar(value=(person.get("CORI Submitted", False) if person else False) or ((person.get("CORI Status", STATUS_NONE) if person else STATUS_NONE) == STATUS_SUBMITTED))
        cori_clr_var = tk.BooleanVar(value=(person.get("CORI Cleared", False) if person else False) or ((person.get("CORI Status", STATUS_NONE) if person else STATUS_NONE) == STATUS_CLEARED))
        checkbox_vars["CORI Required"] = cori_req_var
        checkbox_vars["CORI Submitted"] = cori_sub_var
        checkbox_vars["CORI Cleared"] = cori_clr_var
        self._create_checkbox(cori_opts, CLEARANCE_LABELS['required'], cori_req_var, font="tiny", padx=(0, 0))
        self._create_checkbox(cori_opts, CLEARANCE_LABELS['submitted'], cori_sub_var, font="tiny", padx=(8, 0))
        self._create_checkbox(cori_opts, CLEARANCE_LABELS['cleared'], cori_clr_var, font="tiny", padx=(8, 0))
        
        tk.Label(status_lframe, text=DIALOG_FIELD_LABELS['cori_date'], bg=self.bg_color, font=FONTS["tiny"]).grid(row=3, column=0, sticky="w")
        dates_sub_clr = tk.Frame(status_lframe, bg=self.bg_color)
        dates_sub_clr.grid(row=3, column=1, sticky="w")
        
        cur_sub = person.get("CORI Submit Date", "") if person else ""
        cur_clr = person.get("CORI Cleared Date", "") if person else ""
        
        ent_sub = tk.Entry(dates_sub_clr, font=FONTS["tiny"], width=10, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        ent_sub.pack(side=tk.LEFT)
        ent_sub.insert(0, cur_sub)
        entries["CORI Submit Date"] = ent_sub
        
        tk.Label(dates_sub_clr, text="/", bg=self.bg_color).pack(side=tk.LEFT)
        
        ent_clr = tk.Entry(dates_sub_clr, font=FONTS["tiny"], width=10, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        ent_clr.pack(side=tk.LEFT)
        ent_clr.insert(0, cur_clr)
        entries["CORI Cleared Date"] = ent_clr

        tk.Frame(status_lframe, height=1, bg=SEPARATOR_COLOR).grid(row=4, column=0, columnspan=2, sticky="ew", pady=5)

        # --- NH/ME GC Two-Column Layout ---
        gc_frame = tk.Frame(status_lframe, bg=self.bg_color)
        gc_frame.grid(row=5, column=0, columnspan=2, sticky="ew")
        # NH GC Column
        nh_col = tk.Frame(gc_frame, bg=self.bg_color)
        nh_col.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))
        tk.Label(nh_col, text=DIALOG_FIELD_LABELS['nh_gc'], bg=self.bg_color, font=FONTS["small"]).pack(anchor="w")
        nh_opts = tk.Frame(nh_col, bg=self.bg_color)
        nh_opts.pack(anchor="w")
        nh_req_var = tk.BooleanVar(value=(person.get("NH GC Required", False) if person else False) or ((person.get("NH GC Status", STATUS_NONE) if person else STATUS_NONE) == STATUS_REQUIRED))
        nh_clr_var = tk.BooleanVar(value=(person.get("NH GC Cleared", False) if person else False) or ((person.get("NH GC Status", STATUS_NONE) if person else STATUS_NONE) == STATUS_CLEARED))
        checkbox_vars["NH GC Required"] = nh_req_var
        checkbox_vars["NH GC Cleared"] = nh_clr_var
        self._create_checkbox(nh_opts, CLEARANCE_LABELS['required'], nh_req_var, font="tiny", padx=(0, 0))
        self._create_checkbox(nh_opts, CLEARANCE_LABELS['cleared'], nh_clr_var, font="tiny", padx=(8, 0))
        # NH ID / Exp under NH GC
        tk.Label(nh_col, text=DIALOG_FIELD_LABELS['nh_id_exp'], bg=self.bg_color, font=FONTS["tiny"]).pack(anchor="w")
        nh_details = tk.Frame(nh_col, bg=self.bg_color)
        nh_details.pack(anchor="w")
        ent_nh_id = tk.Entry(nh_details, font=FONTS["tiny"], width=WIDGET_WIDTHS['form_entry_large'], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        ent_nh_id.pack(side=tk.LEFT)
        if person: ent_nh_id.insert(0, person.get("NH GC ID Number", ""))
        entries["NH GC ID Number"] = ent_nh_id
        tk.Label(nh_details, text="/", bg=self.bg_color).pack(side=tk.LEFT)
        ent_nh_exp = tk.Entry(nh_details, font=FONTS["tiny"], width=10, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        ent_nh_exp.pack(side=tk.LEFT)
        if person: ent_nh_exp.insert(0, person.get("NH GC Expiration Date", ""))
        entries["NH GC Expiration Date"] = ent_nh_exp

        # ME GC Column
        me_col = tk.Frame(gc_frame, bg=self.bg_color)
        me_col.pack(side=tk.LEFT, fill=tk.X, expand=True)
        tk.Label(me_col, text=DIALOG_FIELD_LABELS['me_gc'], bg=self.bg_color, font=FONTS["small"]).pack(anchor="w")
        me_opts = tk.Frame(me_col, bg=self.bg_color)
        me_opts.pack(anchor="w")
        me_req_var = tk.BooleanVar(value=(person.get("ME GC Required", False) if person else False) or ((person.get("ME GC Status", STATUS_NONE) if person else STATUS_NONE) == STATUS_REQUIRED))
        me_send_var = tk.BooleanVar(value=(person.get("ME GC Sent", False) if person else False) or ((person.get("ME GC Status", STATUS_NONE) if person else STATUS_NONE) == STATUS_SENT_TO_DENISE))
        checkbox_vars["ME GC Required"] = me_req_var
        checkbox_vars["ME GC Sent"] = me_send_var
        self._create_checkbox(me_opts, CLEARANCE_LABELS['required'], me_req_var, font="tiny", padx=(0, 0))
        self._create_checkbox(me_opts, CLEARANCE_LABELS['sent_to_denise'], me_send_var, font="tiny", padx=(8, 0))
        tk.Label(me_col, text=DIALOG_FIELD_LABELS['me_sent_date'], bg=self.bg_color, font=FONTS["tiny"]).pack(anchor="w")
        ent_me_date = tk.Entry(me_col, font=FONTS["tiny"], width=WIDGET_WIDTHS['form_entry_medium'], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        ent_me_date.pack(anchor="w")
        if person: ent_me_date.insert(0, person.get("ME GC Sent Date", ""))
        entries["ME GC Sent Date"] = ent_me_date

        # Removed ME Guard License Sent; DOD/MVR moved inline with BG date

        # --- DIRECT DEPOSIT SECTION ---
        dd_lframe = tk.LabelFrame(
            right_col,
            text=DIALOG_SECTIONS['direct_deposit'],
            font=FONTS["subheader"],
            bg=self.bg_color,
            fg="#1a3a5a",
            padx=10,
            pady=10
        )
        dd_lframe.grid(row=2, column=0, sticky="nsew", pady=(6, 8))
        dd_lframe.columnconfigure(1, weight=1)

        # Account Type (checkboxes with exclusivity)
        tk.Label(dd_lframe, text=DIALOG_FIELD_LABELS['account_type'], bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).grid(row=0, column=0, sticky="w", pady=5)
        acct_opts = tk.Frame(dd_lframe, bg=self.bg_color)
        acct_opts.grid(row=0, column=1, sticky="w")
        checking_var = tk.BooleanVar(value=(person.get("Deposit Checking", False) if person else False) or ((person.get("Deposit Account Type", "") if person else "") == "Checking"))
        savings_var = tk.BooleanVar(value=(person.get("Deposit Savings", False) if person else False) or ((person.get("Deposit Account Type", "") if person else "") == "Savings"))
        def _on_checking():
            try:
                if checking_var.get():
                    savings_var.set(False)
            except Exception:
                pass
        def _on_savings():
            try:
                if savings_var.get():
                    checking_var.set(False)
            except Exception:
                pass
        checkbox_vars["Deposit Checking"] = checking_var
        checkbox_vars["Deposit Savings"] = savings_var
        tk.Checkbutton(acct_opts, text="Checking", variable=checking_var, command=_on_checking, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT)
        tk.Checkbutton(acct_opts, text="Savings", variable=savings_var, command=_on_savings, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT, padx=(8,0))

        # Bank Name
        bank_entry = self._label_and_entry(dd_lframe, DIALOG_FIELD_LABELS['bank_name'], 1, label_col=0, entry_col=1)
        if person and "Bank Name" in person:
            bank_entry.insert(0, person["Bank Name"])
        entries["Bank Name"] = bank_entry

        # Routing Number
        rtng_entry = self._label_and_entry(dd_lframe, DIALOG_FIELD_LABELS['routing'], 2, label_col=0, entry_col=1)
        if person and "Routing Number" in person:
            rtng_entry.insert(0, person["Routing Number"])
        entries["Routing Number"] = rtng_entry

        # Account Number
        acct_entry = self._label_and_entry(dd_lframe, DIALOG_FIELD_LABELS['account'], 3, label_col=0, entry_col=1)
        if person and "Account Number" in person:
            acct_entry.insert(0, person["Account Number"])
        entries["Account Number"] = acct_entry

        # Additional Notes (Bottom of Right Column)
        notes_lframe = tk.LabelFrame(
            right_col, 
            text=" Additional Notes ", 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        notes_lframe.grid(row=3, column=0, sticky="nsew", pady=(10, 10))
        notes_lframe.columnconfigure(0, weight=1)
        
        notes_txt = tk.Text(notes_lframe, height=6, font=FONTS["small"], wrap=tk.WORD, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        notes_txt.pack(fill=tk.BOTH, expand=True)
        if person and "Notes" in person:
            notes_txt.insert("1.0", person["Notes"])
        
        # We need a way to extract this since it's not a simple Entry/Var
        # We'll attach it to the save_person function's scope by storing it in entries with a special key
        entries["_NOTES_WIDGET_"] = notes_txt
        
        # NH GC Expiry / Clearance Dates (Keeping these for compatibility but merging logic)
        # licensing_lframe removed as per instruction

        # --- UNIFORMS & CLOTHING SECTION (moved to left column) ---
        uniform_lframe = tk.LabelFrame(
            left_col, 
            text=LABEL_TEXT['section_uniforms'], 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg=TEXT_COLORS['label_dark_blue'], 
            padx=10, 
            pady=10
        )
        uniform_lframe.grid(row=3, column=0, sticky="nsew", pady=(10, 0))
        uniform_lframe.columnconfigure(1, weight=1)

        # Sizing Row (Shirt, Pants, Boots)
        sizing_container = tk.Frame(uniform_lframe, bg=self.bg_color)
        sizing_container.grid(row=0, column=0, columnspan=2, sticky="w", pady=5)

        tk.Label(sizing_container, text="Shirt", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT)
        shirt_entry = tk.Entry(sizing_container, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color, width=6)
        shirt_entry.pack(side=tk.LEFT, padx=5)
        if person and "Shirt Size" in person:
            shirt_entry.insert(0, person["Shirt Size"])
        entries["Shirt Size"] = shirt_entry

        tk.Label(sizing_container, text="Pants", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(10, 0))
        pants_entry = tk.Entry(sizing_container, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color, width=WIDGET_WIDTHS['form_entry_small'])
        pants_entry.pack(side=tk.LEFT, padx=5)
        if person and "Pants Size" in person:
            pants_entry.insert(0, person["Pants Size"])
        entries["Pants Size"] = pants_entry

        tk.Label(sizing_container, text="BOOTS", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(10, 0))
        boots_entry = tk.Entry(sizing_container, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color, width=WIDGET_WIDTHS['form_entry_small'])
        boots_entry.pack(side=tk.LEFT, padx=5)
        if person and "Boots Size" in person:
            boots_entry.insert(0, person["Boots Size"])
        entries["Boots Size"] = boots_entry

        # Apply lighter sky-blue header color for later-created label frames
        try:
            is_dark = _is_dark_color(getattr(self, 'bg_color', '#000000'))
            header_fg = TEXT_COLORS['label_header_blue'] if is_dark else TEXT_COLORS['label_light_blue']
            for lf in (
                license_lframe,
                emergency_lframe,
                status_lframe,
                dd_lframe,
                notes_lframe,
                uniform_lframe,
            ):
                try:
                    lf.configure(fg=header_fg)
                except Exception:
                    pass
        except Exception:
            pass

        # Final pass: enforce themed colors on all input fields (Entry/Text)
        try:
            pal_bg = getattr(self, 'card_bg_color', CURRENT_PALETTE.get('card_bg_color', '#ffffff'))
            pal_fg = getattr(self, 'fg_color', CURRENT_PALETTE.get('fg_color', '#2c3e50'))
            def _style_inputs(container):
                for child in container.winfo_children():
                    try:
                        if isinstance(child, tk.Entry) or isinstance(child, tk.Text):
                            try:
                                child.configure(bg=pal_bg, fg=pal_fg, insertbackground=pal_fg)
                            except Exception:
                                pass
                        if isinstance(child, (tk.Checkbutton, tk.Radiobutton)):
                            try:
                                child.configure(fg=pal_fg, activeforeground=pal_fg)
                            except Exception:
                                pass
                        if isinstance(child, (tk.Frame, tk.LabelFrame)):
                            _style_inputs(child)
                    except Exception:
                        pass
            _style_inputs(content_frame)
        except Exception:
            pass

        # Ensure readability for all newly created sections
        try:
            for sect in (license_lframe, emergency_lframe, status_lframe, dd_lframe, notes_lframe, uniform_lframe):
                apply_text_contrast(sect)
        except Exception:
            pass

        # Issuance Row
        issued_var = tk.BooleanVar(value=person.get("Uniform Issued", False) if person else False)
        checkbox_vars["Uniform Issued"] = issued_var
        cb = tk.Checkbutton(uniform_lframe, text=LABEL_TEXT['uniform_issued'], variable=issued_var, bg=self.bg_color, fg=self.fg_color, font=FONTS["small"], selectcolor=self.bg_color, activebackground=self.bg_color, activeforeground=self.fg_color)
        cb.grid(row=1, column=0, columnspan=2, sticky="w", pady=5)

        # Articles Given
        tk.Label(uniform_lframe, text="articles given:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).grid(row=2, column=0, sticky="w", pady=5)
        articles_entry = tk.Entry(uniform_lframe, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        articles_entry.grid(row=2, column=1, sticky="ew", padx=(10, 0), pady=5)
        if person and "Articles Given" in person:
            articles_entry.insert(0, person["Articles Given"])
        entries["Articles Given"] = articles_entry
        
        def save():
            # Robust date normalization helper (prefers python-dateutil if available)
            def _norm_date(s):
                t = (s or '').strip()
                if not t:
                    return ''
                # unify separators and remove extra spaces
                u = t.replace('.', '/').replace('-', '/').replace(' ', '/')
                # Prefer flexible parser from dateutil
                try:
                    import importlib
                    _dtparser = importlib.import_module('dateutil.parser')
                    dt = _dtparser.parse(u, dayfirst=False, yearfirst=False, fuzzy=True)
                    return dt.strftime('%m/%d/%Y')
                except Exception:
                    pass
                # Fallback patterns
                from datetime import datetime
                patterns = [
                    '%m/%d/%Y', '%m/%d/%y', '%Y/%m/%d'
                ]
                for p in patterns:
                    try:
                        dt = datetime.strptime(u, p)
                        return dt.strftime('%m/%d/%Y')
                    except Exception:
                        pass
                # Last resort: trim to 10 chars
                return (u[:10])

            date_fields = {
                'NEO Scheduled Date',
                'Background Completion Date',
                'CORI Submit Date',
                'CORI Cleared Date',
                'NH GC Expiration Date',
                'ME GC Sent Date',
            }
            new_data = {}
            for field, entry in entries.items():
                if field == "_NOTES_WIDGET_":
                    # Special handling for Text widget
                    new_data["Notes"] = entry.get("1.0", "end-1c").strip()
                else:
                    val = ''
                    try:
                        # Combobox handling: preserve previous if blank; canonicalize
                        if isinstance(entry, ttk.Combobox):
                            val = (entry.get() or '').strip()
                            if not val and person and (field in person):
                                val = person.get(field, '')
                            # Normalize to allowed set
                            val = _canonicalize(field, val)
                        else:
                            val = entry.get()
                            # Canonicalize Shirt Size text
                            if field == 'Shirt Size':
                                val = _canonicalize(field, val)
                            # Normalize dates to MM/DD/YYYY and trim to 10
                            if field in date_fields:
                                val = _norm_date(val)
                    except Exception:
                        val = entry.get()
                    new_data[field] = val
            new_data["Branch"] = branch_var.get()

            # Save invisible code values corresponding to comboboxes
            for code_field, (combo_widget, disp_field) in combo_code_widgets.items():
                disp_val = (combo_widget.get() or '').strip()
                code_val = _code_from_display(disp_field, disp_val)
                # Preserve previous code if empty
                if not code_val and person:
                    code_val = person.get(code_field, '')
                new_data[code_field] = code_val
            
            # Save checkbox states
            for cb_field, var in checkbox_vars.items():
                new_data[cb_field] = var.get()

            # Preserve stable UID on edits
            try:
                if index is not None and person and person.get("_uid"):
                    new_data["_uid"] = person.get("_uid")
            except Exception:
                pass

            # Validate date fields (if provided)
            for df in date_fields:
                try:
                    val = (new_data.get(df) or "").strip()
                    if val:
                        datetime.strptime(val, "%m/%d/%Y")
                except Exception:
                    show_error(dialog, "Invalid Date", f"{df} must be in MM/DD/YYYY format.")
                    return

            # Derive status strings from checkboxes (for compatibility)
            # CORI
            try:
                cori_stat = 'None'
                if new_data.get('CORI Cleared'):
                    cori_stat = 'Cleared'
                elif new_data.get('CORI Submitted'):
                    cori_stat = 'Submitted'
                elif new_data.get('CORI Required'):
                    cori_stat = 'Required'
                new_data['CORI Status'] = cori_stat
                new_data['CORI Status_Code'] = _code_from_display('CORI Status', cori_stat)
            except Exception:
                pass
            # NH GC
            try:
                nh_stat = 'None'
                if new_data.get('NH GC Cleared'):
                    nh_stat = 'Cleared'
                elif new_data.get('NH GC Required'):
                    nh_stat = 'Required'
                new_data['NH GC Status'] = nh_stat
                new_data['NH GC Status_Code'] = _code_from_display('NH GC Status', nh_stat)
            except Exception:
                pass
            # ME GC
            try:
                me_stat = 'None'
                if new_data.get('ME GC Sent'):
                    me_stat = 'Sent to Denise'
                elif new_data.get('ME GC Required'):
                    me_stat = 'Required'
                new_data['ME GC Status'] = me_stat
                new_data['ME GC Status_Code'] = _code_from_display('ME GC Status', me_stat)
            except Exception:
                pass
            # Deposit Account Type from exclusive checkboxes
            try:
                acct_type = ''
                if new_data.get('Deposit Checking') and not new_data.get('Deposit Savings'):
                    acct_type = 'Checking'
                elif new_data.get('Deposit Savings') and not new_data.get('Deposit Checking'):
                    acct_type = 'Savings'
                new_data['Deposit Account Type'] = acct_type
                new_data['Deposit Account Type_Code'] = _code_from_display('Deposit Account Type', acct_type)
            except Exception:
                pass
            
            if index is not None:
                self._normalize_person_fields(new_data)
                self.people_data[index] = new_data
            else:
                self._normalize_person_fields(new_data)
                self.people_data.append(new_data)
                
            self.save_data()
            # Use incremental update instead of full re-render
            try:
                self._on_person_saved(index, new_data)
            except Exception:
                # Fallback: full refresh
                self.refresh_blocks()
            dialog.destroy()
        
        # Create button frame inside content_frame (scrollable with content)
        footer_frame = tk.Frame(content_frame, bg=self.bg_color)
        footer_frame.pack(fill=tk.X, pady=(20, 0), padx=(0, 0))
        
        # Save on the left, Cancel on the right
        pack_action_button(footer_frame, "+SAVE", lambda: save(), role="save", font=FONTS["button"], width=BUTTON_WIDTHS['dialog_action'], side=tk.LEFT, padx=10)
        spacer = tk.Frame(footer_frame, bg=self.bg_color)
        spacer.pack(side=tk.LEFT, fill=tk.X, expand=True)
        pack_action_button(footer_frame, "CANCEL", lambda: dialog.destroy(), role="cancel", font=FONTS["button"], width=BUTTON_WIDTHS['dialog_action'], side=tk.RIGHT, padx=10)
        
        # Force the dialog to calculate geometry and display
        dialog.update_idletasks()
        dialog.update()
        
        # Get the required width based on the scrollable frame content
        scrollable_frame.update_idletasks()
        req_width = scrollable_frame.winfo_reqwidth()
        
        # Get the height needed for all content
        canvas.update_idletasks()
        scroll_height = canvas.bbox("all")
        if scroll_height:
            content_height = scroll_height[3] - scroll_height[1]
        else:
            content_height = 600
        
        # Use constrained dimensions to fit contents within screen
        screen_w = dialog.winfo_screenwidth()
        screen_h = dialog.winfo_screenheight()
        max_width = min(1100, max(720, int(screen_w * 0.9)))
        max_height = max(560, int(screen_h * 0.85))
        width = min(req_width, max_width)
        height = min(content_height, max_height)
        
        dialog.geometry(f"{width}x{int(height)}")
        try:
            center_window(dialog, self.root)
        except Exception:
            pass

        def _constrain_dialog_width():
            try:
                if not dialog.winfo_exists() or not canvas.winfo_exists():
                    return
                w = dialog.winfo_width()
                inner = max(0, w - 30)
                canvas.itemconfig(scroll_window_id, width=inner)
                scrollable_frame.configure(width=inner)
                content_frame.configure(width=inner)
                main_form.configure(width=inner)
            except Exception:
                pass

        _constrain_dialog_width()
        
        dialog.update_idletasks()
        
        dialog.deiconify()
        dialog.grab_set()

        try:
            dialog.after(0, _constrain_dialog_width)
        except Exception:
            pass
        
        # Ensure button role colors are applied within the dialog
        try:
            apply_button_roles(content_frame)
        except Exception:
            pass
        # Enforce visible checkbox indicators across the dialog
        try:
            fix_checkbox_contrast(content_frame, use_bg=self.bg_color)
        except Exception:
            pass


def main():
    root = tk.Tk()
    root.withdraw()
    ensure_dirs(
        APP_DATA_DIR,
        os.path.join(APP_DATA_DIR, "Archive"),
        os.path.join(APP_DATA_DIR, "exports"),
        os.path.join(APP_DATA_DIR, "Backups"),
    )

    root.deiconify()
    WorkflowGUI(root)
    root.mainloop()

if __name__ == "__main__":
    main()
