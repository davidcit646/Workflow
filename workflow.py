#!/usr/bin/env python3
"""
Workflow Tracker Backend Module
Core backend functions for Electron/web application.
Builders: David Citarelli, GitHub Copilot
"""

import os
import json
import hashlib
import secrets
import logging
import subprocess
import ctypes
import binascii
from typing import Dict, Any, Optional

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# ENCRYPTION & SECURITY
# ============================================================================
PASSWORD_ITERATIONS = 200_000
PASSWORD_SALT_BYTES = 16
ENCRYPTION_ITERATIONS = 100_000
OPENSSL_CMD = "openssl"

# ============================================================================
# CORE CONSTANTS
# ============================================================================

# Module-level constants
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DATA_DIR = os.path.join(os.path.expanduser("~"), "Documents", "Workflow")
APP_VERSION = "1.0.0"


def ensure_dirs(*paths: str) -> None:
    """Ensure directories exist, create if needed."""
    for path in paths:
        os.makedirs(path, exist_ok=True)


# ============================================================================
# FILE PATHS & DIRECTORIES
# ============================================================================
ARCHIVE_DIR_NAME = "Archive"
EXPORTS_DIR_NAME = "exports"
THEME_PREF_FILE = "theme_pref.json"
AUTH_FILE = os.path.join(APP_DATA_DIR, "prog_auth.json")
ENC_FILE = os.path.join(APP_DATA_DIR, "workflow_data.json.enc")

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

# ============================================================================
# DATA MAPPINGS
# ============================================================================
CODE_MAPS = {
    'CORI Status': [("Not Required", "NOT_REQ"), ("Required", "REQ"), ("Submitted", "SUB"), ("Cleared", "CLR")],
    'NH GC Status': [("None", "NONE"), ("Required", "REQ"), ("Submitted", "SUB"), ("Cleared", "CLR")],
    'NHGC Status': [("None", "NONE"), ("Required", "REQ"), ("Submitted", "SUB"), ("Cleared", "CLR")],
    'ME GC Status': [("None", "NONE"), ("Required", "REQ"), ("Sent to Denise", "SEND")],
    'Maine GC Status': [("None", "NONE"), ("Required", "REQ"), ("Submitted", "SUB"), ("Cleared", "CLR")],
    'ID Type': [("Driver's License", "DL"), ("State ID", "STATE"), ("Passport", "PASS"), ("Other", "OTHER")],
}

STATUS_FIELDS = ['CORI Status', 'NH GC Status', 'ME GC Status', 'Deposit Account Type', 'Shirt Size']
BRANCH_OPTIONS = ["All", "Salem", "Portland"]

CSV_EXPORT_FIELDS = [
    'Scheduled', 'Name', 'Employee ID', 'ICIMS ID', 'Job Name', 'Job Location',
    'Manager Name', 'Branch', 'NEO Scheduled Date', 'Background Completion Date',
    'CORI Status', 'CORI Submit Date', 'CORI Cleared Date',
    'NH GC Status', 'NH GC Expiration Date', 'NH GC ID Number',
    'ME GC Status', 'ME GC Sent Date', 'MVR', 'DOD Clearance',
    'Shirt Size', 'Pants Size', 'Boots', 'Deposit Account Type',
    'Bank Name', 'Routing Number', 'Account Number',
    'EC First Name', 'EC Last Name', 'EC Relationship', 'EC Phone Number',
    'Other ID', 'State', 'ID No.', 'Exp.', 'DOB', 'Social', 'Notes'
]

PERSONAL_ID_FIELDS = ["State", "ID No.", "Exp.", "DOB", "Social"]

ARCHIVE_SECTIONS = {
    'candidate_info': "Candidate Info",
    'neo_hours': "NEO Hours", 
    'uniform_sizes': "Uniform Sizes",
    'bank_info': "Bank Info",
    'personal_id': "Personal ID",
    'emergency_contact': "Emergency Contact",
    'notes': "Notes"
}

# ============================================================================
# SECURITY FUNCTIONS
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
        use_libcrypto = os.environ.get("WORKFLOW_USE_LIBCRYPTO", "0") == "1"
        if use_libcrypto:
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

    def decrypt_bytes(self, encrypted_bytes: bytes) -> bytes | None:
        try:
            if not encrypted_bytes:
                return None
            if self._lib is not None:
                try:
                    plain = self._decrypt_bytes_with_lib(encrypted_bytes)
                    return plain
                except (RuntimeError, ValueError):
                    pass
            if not self.password:
                return None
            result = subprocess.run(
                [
                    "openssl",
                    "aes-256-cbc",
                    "-d",
                    "-pbkdf2",
                    "-iter",
                    "100000",
                    "-k",
                    str(self.password),
                    "-in",
                    "-",
                ],
                input=encrypted_bytes,
                capture_output=True,
                text=False,
                check=True,
            )
            return result.stdout
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

    def encrypt_bytes(self, plain_bytes: bytes) -> bytes | None:
        try:
            if plain_bytes is None:
                return None
            data = plain_bytes
            if self._lib is not None:
                try:
                    return self._encrypt_bytes_with_lib(data)
                except (RuntimeError, OSError, IOError, ValueError):
                    pass
            if not self.password:
                return None
            result = subprocess.run(
                [
                    OPENSSL_CMD,
                    "aes-256-cbc",
                    "-e",
                    "-pbkdf2",
                    "-iter",
                    "100000",
                    "-k",
                    str(self.password),
                    "-in",
                    "-",
                ],
                input=data,
                capture_output=True,
                text=False,
                check=True,
            )
            return result.stdout
        except subprocess.CalledProcessError:
            return None

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
        # Setup OpenSSL context
        ctx = lib.EVP_CIPHER_CTX_new()
        if not ctx:
            raise RuntimeError("Failed to create cipher context")
        
        try:
            cipher = lib.EVP_aes_256_cbc()
            if lib.EVP_EncryptInit_ex(ctx, cipher, None, key, iv) != 1:
                raise RuntimeError("Failed to init encryption")
            
            # Pad data to block size
            pad_len = 16 - (len(data) % 16)
            padded_data = data + bytes([pad_len] * pad_len)
            
            ciphertext = bytearray(len(padded_data))
            out_len = ctypes.c_int()
            total_len = 0
            
            if lib.EVP_EncryptUpdate(ctx, ciphertext, ctypes.byref(out_len), padded_data, len(padded_data)) != 1:
                raise RuntimeError("Failed to encrypt")
            total_len += out_len.value
            
            if lib.EVP_EncryptFinal_ex(ctx, ciphertext[total_len:], ctypes.byref(out_len)) != 1:
                raise RuntimeError("Failed to finalize encryption")
            total_len += out_len.value
            
            # Build output: header + salt + iter + ciphertext
            header = b'PBKDF2v1'
            iter_bytes = iterations.to_bytes(4, byteorder='big')
            return header + salt + iter_bytes + ciphertext[:total_len]
        finally:
            lib.EVP_CIPHER_CTX_free(ctx)

    def _decrypt_bytes_with_lib(self, enc: bytes) -> bytes | None:
        # Expect header: b'PBKDF2v1' + salt(16) + iter(4)
        if len(enc) < 8 + 16 + 4:
            return None
        
        header = enc[:8]
        if header != b'PBKDF2v1':
            return None
        
        salt = enc[8:24]
        iterations = int.from_bytes(enc[24:28], byteorder='big')
        ciphertext = enc[28:]
        
        key, iv = self._derive_key_iv(self.password, salt, iterations)
        
        lib = self._lib
        ctx = lib.EVP_CIPHER_CTX_new()
        if not ctx:
            raise RuntimeError("Failed to create cipher context")
        
        try:
            cipher = lib.EVP_aes_256_cbc()
            if lib.EVP_DecryptInit_ex(ctx, cipher, None, key, iv) != 1:
                raise RuntimeError("Failed to init decryption")
            
            plaintext = bytearray(len(ciphertext))
            out_len = ctypes.c_int()
            total_len = 0
            
            if lib.EVP_DecryptUpdate(ctx, plaintext, ctypes.byref(out_len), ciphertext, len(ciphertext)) != 1:
                raise RuntimeError("Failed to decrypt")
            total_len += out_len.value
            
            if lib.EVP_DecryptFinal_ex(ctx, plaintext[total_len:], ctypes.byref(out_len)) != 1:
                raise RuntimeError("Failed to finalize decryption")
            total_len += out_len.value
            
            # Remove padding
            if total_len == 0:
                return None
            pad_len = plaintext[total_len - 1]
            if pad_len > 16 or pad_len > total_len:
                return None
            return bytes(plaintext[:total_len - pad_len])
        finally:
            lib.EVP_CIPHER_CTX_free(ctx)


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def get_person_display_name(person: Dict[str, Any]) -> str:
    """Get display name for a person."""
    return person.get('Name', person.get('name', 'Unnamed'))


def get_person_status(person: Dict[str, Any]) -> str:
    """Get onboarding status for a person."""
    return person.get('Onboarding Status', 'Unknown')


def validate_email(email: str) -> bool:
    """Basic email validation."""
    import re
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_phone(phone: str) -> bool:
    """Basic phone validation."""
    import re
    # Remove common formatting
    clean_phone = re.sub(r'[^\d]', '', phone)
    return len(clean_phone) >= 10


def format_phone_number(phone: str) -> str:
    """Format phone number consistently."""
    import re
    clean_phone = re.sub(r'[^\d]', '', phone)
    if len(clean_phone) == 10:
        return f"({clean_phone[:3]}) {clean_phone[3:6]}-{clean_phone[6:]}"
    elif len(clean_phone) > 10 and clean_phone[0] == '1':
        return f"+1 ({clean_phone[1:4]}) {clean_phone[4:7]}-{clean_phone[7:]}"
    return phone


def validate_date_format(date_str: str) -> bool:
    """Validate MM/DD/YYYY date format."""
    import re
    from datetime import datetime, timedelta, timezone
    try:
        if not re.match(r'^\d{2}/\d{2}/\d{4}$', date_str):
            return False
        # Use modern datetime parsing to avoid deprecation warnings
        datetime.strptime(date_str, '%m/%d/%Y')
        return True
    except ValueError:
        return False


def sanitize_filename(filename: str) -> str:
    """Sanitize filename for safe file system usage."""
    import re
    # Remove or replace unsafe characters
    safe_name = re.sub(r'[<>:"/\\|?*]', '_', filename)
    # Remove leading/trailing spaces and dots
    safe_name = safe_name.strip(' .')
    # Limit length
    if len(safe_name) > 255:
        safe_name = safe_name[:255]
    return safe_name or 'unnamed'


# ============================================================================
# DATA PROCESSING FUNCTIONS
# ============================================================================

def calculate_onboarding_summary(people: list) -> Dict[str, int]:
    """Calculate summary statistics for onboarding status."""
    summary = {
        'total': len(people),
        'not-scheduled': 0,
        'neo-scheduled': 0,
        'in-progress': 0,
        'completed': 0
    }
    
    for person in people:
        status = person.get('Onboarding Status', '').lower()
        if status == 'not scheduled':
            summary['not-scheduled'] += 1
        elif status == 'neo scheduled':
            summary['neo-scheduled'] += 1
        elif status == 'in progress':
            summary['in-progress'] += 1
        elif status == 'completed':
            summary['completed'] += 1
    
    return summary


def filter_people_by_branch(people: list, branch: str) -> list:
    """Filter people by branch."""
    if not branch or branch.lower() == 'all':
        return people
    return [p for p in people if p.get('Branch', '').lower() == branch.lower()]


def search_people(people: list, query: str) -> list:
    """Search people by name, email, or other fields."""
    if not query:
        return people
    
    query_lower = query.lower()
    results = []
    
    for person in people:
        # Search in common fields
        searchable_fields = [
            'Name', 'name', 'Candidate Email', 'Email', 
            'Employee ID', 'ICIMS ID', 'Job Name', 'Job Location'
        ]
        
        for field in searchable_fields:
            value = person.get(field, '')
            if query_lower in str(value).lower():
                results.append(person)
                break
    
    return results


def validate_person_data(person: Dict[str, Any]) -> Dict[str, Any]:
    """Validate and clean person data."""
    errors = []
    warnings = []
    
    # Required fields
    required_fields = ['Name']
    for field in required_fields:
        if not person.get(field, '').strip():
            errors.append(f"{field} is required")
    
    # Email validation
    email = person.get('Candidate Email', '').strip()
    if email and not validate_email(email):
        warnings.append(f"Invalid email format: {email}")
    
    # Phone validation
    phone = person.get('Candidate Phone Number', '').strip()
    if phone and not validate_phone(phone):
        warnings.append(f"Invalid phone format: {phone}")
    
    # Date validation
    date_fields = ['NEO Scheduled Date', 'Background Completion Date', 'DOB']
    for field in date_fields:
        date_val = person.get(field, '').strip()
        if date_val and not validate_date_format(date_val):
            warnings.append(f"Invalid date format for {field}: {date_val}")
    
    return {
        'valid': len(errors) == 0,
        'errors': errors,
        'warnings': warnings
    }


# ============================================================================
# MAIN ENTRY POINT (for standalone testing)
# ============================================================================

if __name__ == "__main__":
    print(f"Workflow Backend Module v{APP_VERSION}")
    print(f"Data directory: {APP_DATA_DIR}")
    ensure_dirs(APP_DATA_DIR)
    print("Backend module loaded successfully.")
