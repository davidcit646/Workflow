#!/usr/bin/env python3
"""
Workflow Tracker GUI
Track employee onboarding progress with blocks of tea :).
"""

import sys
from tkinter import simpledialog
import tkinter as tk
from tkinter import ttk, messagebox
import os
import json
import csv
import subprocess
import re
import shutil
from datetime import datetime
import hashlib
import binascii
import secrets
import io
import zipfile
import ctypes
import struct
import ui_helpers

# Alias commonly used helpers to preserve existing references
FONTS = ui_helpers.FONTS
make_action_button = ui_helpers.make_action_button
pack_action_button = ui_helpers.pack_action_button
make_card_styles = ui_helpers.make_card_styles
build_search_bar = ui_helpers.build_search_bar
create_kv_row = ui_helpers.create_kv_row
add_separator = ui_helpers.add_separator
build_uniform_row = ui_helpers.build_uniform_row
build_info_bar = ui_helpers.build_info_bar
build_section_header = ui_helpers.build_section_header
build_neo_badge = ui_helpers.build_neo_badge
show_error = ui_helpers.show_error
show_info = ui_helpers.show_info
show_warning = ui_helpers.show_warning
ask_yes_no = ui_helpers.ask_yes_no
show_message_dialog = ui_helpers.show_message_dialog
detect_theme_engine = ui_helpers.detect_theme_engine
pick_initial_theme = ui_helpers.pick_initial_theme
set_engine_theme = ui_helpers.set_engine_theme
get_palette = ui_helpers.get_palette
apply_palette = ui_helpers.apply_palette
apply_stylesheet = ui_helpers.apply_stylesheet
reset_stylesheet = ui_helpers.reset_stylesheet
apply_chrome_tokens = ui_helpers.apply_chrome_tokens
apply_text_contrast = ui_helpers.apply_text_contrast
apply_button_roles = ui_helpers.apply_button_roles
fix_checkbox_contrast = ui_helpers.fix_checkbox_contrast
_is_dark_color = ui_helpers._is_dark_color
CURRENT_PALETTE = ui_helpers.CURRENT_PALETTE

# Add local vendor directory to import path for bundled libraries
try:
    _BASE_DIR = os.path.dirname(os.path.abspath(__file__))
    _VENDOR_DIR = os.path.join(_BASE_DIR, 'vendor')
    if os.path.isdir(_VENDOR_DIR) and _VENDOR_DIR not in sys.path:
        sys.path.insert(0, _VENDOR_DIR)
except Exception:
    pass

# Month lookup used for archiving folder names
MONTHS = {
    '01': 'January', '02': 'February', '03': 'March', '04': 'April',
    '05': 'May', '06': 'June', '07': 'July', '08': 'August',
    '09': 'September', '10': 'October', '11': 'November', '12': 'December'
}


# Removed legacy style constants and local font helper; shared helpers cover styling.


def _hash_password(password: str, salt: bytes | None = None, iterations: int = 200_000):
    if salt is None:
        salt = secrets.token_bytes(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return {
        'salt': salt.hex(),
        'iterations': iterations,
        'key': key.hex()
    }


def _verify_password(password: str, salt_hex: str, iterations: int, key_hex: str) -> bool:
    salt = bytes.fromhex(salt_hex)
    key = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations)
    return binascii.hexlify(key).decode() == key_hex


    


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
            except Exception:
                continue

    def decrypt(self, encrypted_file):
        """Decrypts a file and returns the plain text string."""
        # Read encrypted bytes
        try:
            with open(encrypted_file, 'rb') as f:
                enc = f.read()
        except Exception:
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
            except Exception:
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
                    except Exception:
                        pass
                    return True
                except Exception:
                    pass

            # Fallback: use OpenSSL CLI
            if not self.password:
                raise Exception("Encryption password is not set.")
            process = subprocess.Popen([
                "openssl", "aes-256-cbc", "-e", "-pbkdf2", "-iter", "100000", "-k", str(self.password), "-out", output_file
            ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False)
            stdout, stderr = process.communicate(input=data)

            if process.returncode != 0:
                raise Exception(f"Encryption failed: {stderr}")

            try:
                os.chmod(output_file, 0o600)
            except Exception:
                pass
            return True
        except Exception as e:
            print(f"Encryption error: {e}")
            return False

    # --- In-process AES helpers using libcrypto ---
    def _derive_key_iv(self, password: str, salt: bytes, iterations: int = 100000):
        # Derive 48 bytes: 32 for key, 16 for IV
        if password is None or password == "":
            raise RuntimeError("Password is required for key derivation.")
        dk = hashlib.pbkdf2_hmac('sha256', password.encode('utf-8'), salt, iterations, dklen=48)
        return dk[:32], dk[32:48]

    def _encrypt_bytes_with_lib(self, data: bytes) -> bytes:
        # Format: b'PBKDF2v1' + salt(16) + iter(4 BE) + ciphertext
        salt = secrets.token_bytes(16)
        iterations = 100000
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
        EVP_EncryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
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
            res = EVP_EncryptInit_ex(ctx, EVP_aes_256_cbc(), None, ctypes.c_char_p(key), ctypes.c_char_p(iv))
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
        EVP_DecryptInit_ex.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_char_p, ctypes.c_char_p]
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
            res = EVP_DecryptInit_ex(ctx, EVP_aes_256_cbc(), None, ctypes.c_char_p(key), ctypes.c_char_p(iv))
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

class LoginDialog(tk.Toplevel):
    def __init__(self, parent, task="login"):
        super().__init__(parent)
        self.title("Security Check" if task=="login" else "Set Master Password")
        # Slightly larger dialog for better accessibility
        self.geometry("520x260")
        self.resizable(False, False)
        self.result = None
        self.task = task
        
        # UI Setup
        dlg_bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
        dlg_fg = CURRENT_PALETTE.get('fg_color', '#2c3e50')
        field_bg = CURRENT_PALETTE.get('card_bg_color', '#ffffff')
        self.configure(bg=dlg_bg)
        self.protocol("WM_DELETE_WINDOW", self.on_cancel)
        
        main_frame = tk.Frame(self, bg=dlg_bg, padx=30, pady=30)
        main_frame.pack(expand=True, fill="both")
        
        icon_lbl = tk.Label(main_frame, text="Security", font=FONTS["header"], bg=dlg_bg, fg=dlg_fg)
        icon_lbl.pack()
        
        msg = "Enter your Master Password to unlock the database:" if task=="login" else "Create a Master Password for your new database:"
        tk.Label(main_frame, text=msg, bg=dlg_bg, fg=dlg_fg, wraplength=420, font=FONTS["body"]).pack(pady=(0, 12))

        # Larger entry for easier interaction
        self.pw_entry = tk.Entry(main_frame, show="*", font=FONTS["subheader"], justify="center", bg=field_bg, fg=dlg_fg, insertbackground=dlg_fg)
        self.pw_entry.pack(fill="x", pady=8, ipady=6)
        self.pw_entry.focus_set()
        self.pw_entry.bind("<Return>", lambda e: self.on_confirm())
        
        btn_frame = tk.Frame(main_frame, bg=dlg_bg)
        btn_frame.pack(pady=10)

        # Create standardized action buttons
        btn_confirm = make_action_button(btn_frame, "Confirm", self.on_confirm, role="confirm", font=FONTS["button"], width=14)
        btn_confirm.pack(side=tk.LEFT, padx=12)
        btn_confirm.configure(default="active")
        btn_exit = make_action_button(btn_frame, "Exit", self.on_cancel, role="cancel", font=FONTS["button"], width=14)
        btn_exit.pack(side=tk.LEFT, padx=12)

        # Make Enter/Return and keypad Enter invoke the Confirm button, and Escape invoke Exit
        self.bind("<Return>", lambda e: btn_confirm.invoke())
        self.bind("<KP_Enter>", lambda e: btn_confirm.invoke())
        self.bind("<Escape>", lambda e: btn_exit.invoke())

        self.transient(parent)
        self.grab_set()

    def on_confirm(self):
        pw = self.pw_entry.get().strip()
        if not pw:
            show_warning(self, "Warning", "Password cannot be empty.")
            return
        self.result = pw
        self.destroy()

    def on_cancel(self):
        self.result = None
        self.destroy()


class ArchivePasswordDialog(tk.Toplevel):
    def __init__(self, parent, prompt="Enter archive password:", default=""):
        super().__init__(parent)
        self.title("Archive Password")
        self.geometry("480x200")
        self.resizable(False, False)
        self.result = None

        dlg_bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
        dlg_fg = CURRENT_PALETTE.get('fg_color', '#2c3e50')
        field_bg = CURRENT_PALETTE.get('card_bg_color', '#ffffff')
        self.configure(bg=dlg_bg)
        self.protocol("WM_DELETE_WINDOW", self.on_cancel)

        main_frame = tk.Frame(self, bg=dlg_bg, padx=24, pady=20)
        main_frame.pack(expand=True, fill="both")

        tk.Label(main_frame, text=prompt, bg=dlg_bg, fg=dlg_fg, font=FONTS["body"]).pack(pady=(0, 8))
        self.pw_entry = tk.Entry(main_frame, show="*", font=FONTS["subheader"], justify="center", bg=field_bg, fg=dlg_fg, insertbackground=dlg_fg)
        self.pw_entry.pack(fill="x", pady=8, ipady=6)
        if default:
            try:
                self.pw_entry.insert(0, default)
            except Exception:
                pass
        btn_frame = tk.Frame(main_frame, bg=dlg_bg)
        btn_frame.pack(pady=10)
        btn_confirm = make_action_button(btn_frame, "Confirm", self.on_confirm, role="confirm", font=FONTS["button"], width=14)
        btn_confirm.pack(side=tk.LEFT, padx=8)
        btn_cancel = make_action_button(btn_frame, "Cancel", self.on_cancel, role="cancel", font=FONTS["button"], width=14)
        btn_cancel.pack(side=tk.LEFT, padx=8)

        self.bind("<Return>", lambda e: btn_confirm.invoke())
        self.bind("<Escape>", lambda e: btn_cancel.invoke())

        # Make dialog modal and viewable before grabbing
        self.transient(parent)
        try:
            # Center relative to parent
            self.update_idletasks()
            pw, ph = 480, 200
            px = parent.winfo_rootx()
            py = parent.winfo_rooty()
            pW = parent.winfo_width() or 600
            pH = parent.winfo_height() or 400
            x = px + (pW - pw) // 2
            y = py + (pH - ph) // 2
            self.geometry(f"{pw}x{ph}+{x}+{y}")
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
            # If grab fails, continue without modal grab
            pass
        try:
            self.attributes("-topmost", True)
        except Exception:
            pass
        try:
            self.pw_entry.focus_set()
        except Exception:
            pass

    def on_confirm(self):
        pw = self.pw_entry.get().strip()
        if not pw:
            show_warning(self, "Warning", "Password cannot be empty.")
            return
        self.result = pw
        self.destroy()

    def on_cancel(self):
        self.result = None
        self.destroy()


class ChangePasswordDialog(tk.Toplevel):
    def __init__(self, parent):
        super().__init__(parent)
        self.title("Change Program Password")
        self.geometry("520x280")
        self.resizable(False, False)
        self.result = None

        dlg_bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
        dlg_fg = CURRENT_PALETTE.get('fg_color', '#2c3e50')
        field_bg = CURRENT_PALETTE.get('card_bg_color', '#ffffff')
        self.configure(bg=dlg_bg)
        self.protocol("WM_DELETE_WINDOW", self.on_cancel)

        main_frame = tk.Frame(self, bg=dlg_bg, padx=24, pady=18)
        main_frame.pack(expand=True, fill="both")

        tk.Label(main_frame, text="Enter current password:", bg=dlg_bg, fg=dlg_fg, font=FONTS["body"]).pack(anchor="w")
        self.old_entry = tk.Entry(main_frame, show="*", font=FONTS["small"], bg=field_bg, fg=dlg_fg, insertbackground=dlg_fg) 
        self.old_entry.pack(fill="x", pady=6)

        tk.Label(main_frame, text="New password:", bg=dlg_bg, fg=dlg_fg, font=FONTS["body"]).pack(anchor="w")
        self.new_entry = tk.Entry(main_frame, show="*", font=FONTS["small"], bg=field_bg, fg=dlg_fg, insertbackground=dlg_fg) 
        self.new_entry.pack(fill="x", pady=6)

        tk.Label(main_frame, text="Confirm new password:", bg=dlg_bg, fg=dlg_fg, font=FONTS["body"]).pack(anchor="w")
        self.confirm_entry = tk.Entry(main_frame, show="*", font=FONTS["small"], bg=field_bg, fg=dlg_fg, insertbackground=dlg_fg) 
        self.confirm_entry.pack(fill="x", pady=6)

        btn_frame = tk.Frame(main_frame, bg=dlg_bg)
        btn_frame.pack(pady=10)
        btn_confirm = make_action_button(btn_frame, "Change", self.on_confirm, role="confirm", font=FONTS["button"], width=14)
        btn_confirm.pack(side=tk.LEFT, padx=8)
        btn_cancel = make_action_button(btn_frame, "Cancel", self.on_cancel, role="cancel", font=FONTS["button"], width=14)
        btn_cancel.pack(side=tk.LEFT, padx=8)

        self.bind("<Return>", lambda e: btn_confirm.invoke())
        self.bind("<Escape>", lambda e: btn_cancel.invoke())

        self.transient(parent)
        self.grab_set()

    def on_confirm(self):
        old = self.old_entry.get().strip()
        new = self.new_entry.get().strip()
        conf = self.confirm_entry.get().strip()
        if not old or not new:
            show_warning(self, "Warning", "Passwords cannot be empty.")
            return
        if new != conf:
            show_warning(self, "Warning", "New passwords do not match.")
            return
        self.result = (old, new)
        self.destroy()

    def on_cancel(self):
        self.result = None
        self.destroy()

class ArchiveViewer(tk.Toplevel):
    def __init__(self, parent, archive_dir, password=None):
        super().__init__(parent)
        self.title("Archive Browser")
        self.geometry("900x650")
        self.archive_dir = archive_dir
        self.password = password
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
        
        tk.Label(left_frame, text="Select Candidate", font=FONTS["subtext_bold"], bg=self.bg_color, fg=self.fg_color).pack(fill=tk.X)
        
        self.tree = ttk.Treeview(left_frame, show="tree")
        self.tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        scrollbar = ttk.Scrollbar(left_frame, orient=tk.VERTICAL, command=self.tree.yview)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.tree.configure(yscrollcommand=scrollbar.set)
        
        self.tree.bind("<<TreeviewSelect>>", self.on_select)
        
        # Right Panel: Text Viewer
        right_frame = tk.Frame(self.paned, bg=self.bg_color)
        self.paned.add(right_frame)
        
        self.title_lbl = tk.Label(right_frame, text="Candidate Details", font=FONTS["subtext_bold"], bg=self.bg_color, fg=self.fg_color, anchor="w", padx=10)
        self.title_lbl.pack(fill=tk.X)
        
        self.text_view = tk.Text(right_frame, font=FONTS["mono"], state=tk.DISABLED, undo=False, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        self.text_view.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        
        text_scroll = ttk.Scrollbar(right_frame, orient=tk.VERTICAL, command=self.text_view.yview)
        text_scroll.pack(side=tk.RIGHT, fill=tk.Y)
        self.text_view.configure(yscrollcommand=text_scroll.set)
        
        self.load_archive_list()

    def load_archive_list(self):
        """Finds .zip (plain or encrypted) files and populates the tree with their contents."""
        if not os.path.exists(self.archive_dir):
            return

        # Only show .zip files (no .7z)
        archives = [f for f in os.listdir(self.archive_dir) if f.endswith(".zip")]
        archives.sort(reverse=True)

        for arch in archives:
            # Insert top-level archive nodes only; contents load on selection
            arch_node = self.tree.insert("", "end", text=arch, values=(arch, ""))

    def load_archive_contents(self, archive_name, parent_node):
        """Lists internal folders and files for .zip (plain or encrypted) archives."""
        try:
            arch_path = os.path.join(self.archive_dir, archive_name)
            month_nodes = {}
            names = []
            # Try to open as encrypted zip first
            encrypted = False
            try:
                # Prefer in-process libcrypto format first
                sec = SecurityManager(self.password)
                dec_data = None
                try:
                    with open(arch_path, 'rb') as f:
                        enc_bytes = f.read()
                    if sec._lib:
                        dec_data = sec._decrypt_bytes_with_lib(enc_bytes)
                except Exception:
                    dec_data = None

                if dec_data:
                    zbuf = io.BytesIO(dec_data)
                    with zipfile.ZipFile(zbuf, 'r') as z:
                        names = z.namelist()
                    encrypted = True
                else:
                    # Fallback: OpenSSL CLI compatible
                    if not self.password:
                        show_warning(self, "Archive Password Required", "Please select the archive and enter its password to view contents.")
                        return
                    proc = subprocess.run([
                        "openssl", "aes-256-cbc", "-d", "-pbkdf2", "-iter", "100000",
                        "-k", str(self.password), "-in", arch_path
                    ], capture_output=True)
                    if proc.returncode != 0 or not proc.stdout:
                        # If decrypt fails, try plain zip (legacy). Otherwise, report error.
                        try:
                            with zipfile.ZipFile(arch_path, 'r') as z:
                                names = z.namelist()
                            encrypted = False
                        except Exception:
                            show_error(self, "Archive Error", "Incorrect archive password or the archive is corrupted.")
                            return
                    else:
                        data = proc.stdout
                        zbuf = io.BytesIO(data)
                        with zipfile.ZipFile(zbuf, 'r') as z:
                            names = z.namelist()
                        encrypted = True
            except Exception:
                # Not encrypted, try as plain zip
                try:
                    with zipfile.ZipFile(arch_path, 'r') as z:
                        names = z.namelist()
                except Exception:
                    show_error(self, "Archive Error", "Unable to open archive. It may be encrypted or corrupted.")
                    return

            # If not encrypted, simply list contents; actual encryption
            # will be performed when the user selects the archive node.

            for internal_path in names:
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
            show_error(self, "Archive Error", f"An unexpected error occurred while listing the archive: {e}")

    def on_select(self, event):
        selected = self.tree.selection()
        if not selected: return
        item = self.tree.item(selected[0])
        values = item.get("values") or ()
        # If selecting a top-level archive node, prompt for password if needed,
        # then ensure it's encrypted and load contents.
        if len(values) >= 1 and (len(values) < 2 or not values[1]):
            archive_name = values[0]
            if not self.password:
                dialog = ArchivePasswordDialog(self, prompt=f"Enter password for {archive_name}:", default="")
                self.wait_window(dialog)
                if not dialog.result:
                    return
                self.password = dialog.result
            self.ensure_archive_encrypted(archive_name)
            # Reload its contents after potential encryption
            self.tree.delete(*self.tree.get_children(selected[0]))
            self.load_archive_contents(archive_name, selected[0])
            return
        # Otherwise, it's a file node inside an archive
        if len(values) < 2:
            return
        archive_name, internal_path = values[0], values[1]
        if not internal_path:
            return
        self.view_archive_file(archive_name, internal_path)

    def ensure_archive_encrypted(self, archive_name):
        """Encrypts a plain .zip archive in place using the viewer password.
        Shows a topmost confirmation dialog when encryption occurs.
        """
        arch_path = os.path.join(self.archive_dir, archive_name)
        # First, detect if already encrypted by attempting decrypt
        already_encrypted = False
        try:
            sec = SecurityManager(self.password)
            with open(arch_path, 'rb') as f:
                enc_bytes = f.read()
            if sec._lib:
                dec = sec._decrypt_bytes_with_lib(enc_bytes)
                if dec:
                    already_encrypted = True
        except Exception:
            pass

        if already_encrypted:
            return False

        # Try open as plain zip to confirm it's not encrypted
        try:
            with zipfile.ZipFile(arch_path, 'r') as z:
                _ = z.namelist()
        except Exception:
            # Not a plain zip either; do nothing
            return False

        # Perform encryption in place
        try:
            with open(arch_path, 'rb') as f:
                zip_bytes = f.read()
            sec = SecurityManager(self.password)
            enc_data = None
            try:
                enc_data = sec._encrypt_bytes_with_lib(zip_bytes) if sec._lib else None
            except Exception:
                enc_data = None
            if enc_data is None:
                if not self.password:
                    show_error(self, "Encryption Error", "Archive password is not set.")
                    return False
                proc = subprocess.Popen([
                    "openssl", "aes-256-cbc", "-e", "-pbkdf2", "-iter", "100000",
                    "-k", str(self.password), "-out", arch_path
                ], stdin=subprocess.PIPE)
                proc.communicate(input=zip_bytes)
                if proc.returncode != 0:
                    show_error(self, "Encryption Error", "Failed to encrypt archive.")
                    return False
            else:
                with open(arch_path, 'wb') as f:
                    f.write(enc_data)

            # Confirmation dialog using shared helpers (already topmost)
            show_info(self, "Archive Secured", "The selected archive was not password protected. It has now been secured with your archive password.")
            return True
        except Exception as e:
            print(f"Error securing archive {archive_name}: {e}")
            show_error(self, "Encryption Error", "Failed to encrypt archive.")
            return False

    # Removed: redundant topmost wrapper; show_info/show_error enforce topmost via ui_helpers.

    def view_archive_file(self, archive_name, internal_path):
        """Extracts file to stdout and displays in text view."""
        try:
            arch_path = os.path.join(self.archive_dir, archive_name)
            internal_path = internal_path.replace('\\', '/')
            content = ''
            # Always treat as encrypted zip; prompt for password if not set
            if not self.password:
                dialog = ArchivePasswordDialog(self, prompt=f"Enter password for {archive_name}:", default="")
                self.wait_window(dialog)
                if not dialog.result:
                    return
                self.password = dialog.result
            try:
                # Try libcrypto-based format first
                sec = SecurityManager(self.password)
                dec_data = None
                try:
                    with open(arch_path, 'rb') as f:
                        enc_bytes = f.read()
                    if sec._lib:
                        dec_data = sec._decrypt_bytes_with_lib(enc_bytes)
                except Exception:
                    dec_data = None

                if dec_data:
                    zbuf = io.BytesIO(dec_data)
                    with zipfile.ZipFile(zbuf, 'r') as z:
                        raw = z.read(internal_path)
                else:
                    # Fallback: OpenSSL CLI compatible
                    if not self.password:
                        raise RuntimeError("Archive password is not set")
                    proc = subprocess.run([
                        "openssl", "aes-256-cbc", "-d", "-pbkdf2", "-iter", "100000",
                        "-k", str(self.password), "-in", arch_path
                    ], capture_output=True, check=True)
                    data = proc.stdout
                    zbuf = io.BytesIO(data)
                    with zipfile.ZipFile(zbuf, 'r') as z:
                        raw = z.read(internal_path)

                if isinstance(raw, bytes):
                    try:
                        content = raw.decode('utf-8')
                    except Exception:
                        content = raw.decode('utf-8', errors='replace')
                else:
                    content = str(raw)
            except subprocess.CalledProcessError:
                show_error(self, "Extraction Error", "Incorrect archive password or corrupt archive.")
                return
            except KeyError:
                show_error(self, "Extraction Error", "File not found in archive.")
                return

            # Update UI
            self.title_lbl.config(text=f"Viewing: {os.path.basename(internal_path)}")
            self.text_view.config(state=tk.NORMAL)
            self.text_view.delete("1.0", tk.END)
            self.text_view.insert(tk.END, content)
            self.text_view.config(state=tk.DISABLED)
        except Exception as e:
            show_error(self, "Extraction Error", f"Could not read archived file:\n{e}")

class WorkflowGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Candidate Tracker")
        self.root.geometry("1500x1000")
        self.root.resizable(True, True)
        # Theme engine tracking (delegated to ui_helpers)
        self._theme_engine, self._tb_style = detect_theme_engine()
        # Default to light, then override from persisted preference (1=light, 2=dark)
        self._current_theme = 'light'
        try:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            self._base_dir = base_dir
            pref_path = os.path.join(base_dir, 'data', 'theme_pref.json')
            if os.path.exists(pref_path):
                with open(pref_path, 'r', encoding='utf-8') as f:
                    val = json.load(f)
                num = None
                if isinstance(val, dict):
                    num = val.get('theme')
                elif isinstance(val, (int, str)):
                    try:
                        num = int(val)
                    except Exception:
                        num = None
                if num == 2:
                    self._current_theme = 'dark'
                else:
                    self._current_theme = 'light'
        except Exception:
            self._current_theme = 'light'
        # Apply initial engine theme
        self._tb_style = set_engine_theme(self.root, self._theme_engine, self._current_theme, self._tb_style)
        # Hotkeys for theme toggling
        try:
            self.root.bind('<F6>', lambda e: self.toggle_theme())
        except Exception:
            pass
        try:
            self.root.bind('<Control-Shift-D>', lambda e: self.toggle_theme())
            self.root.bind('<Control-d>', lambda e: self.toggle_theme())
        except Exception:
            pass
        
        # Set color scheme (Light Theme upgrade)
        self.bg_color = "#e2e6e9" # Slightly darker gray for better contrast
        self.fg_color = "#2c3e50"
        self.accent_color = "#3498db"
        self.button_color = "#27ae60"
        self.error_color = "#e74c3c"
        self.warning_color = "#f39c12"
        self.card_bg_color = "#ffffff" # Pure White

        # Shared form fonts and styles (centralized tokens)
        self.form_label_font = FONTS["small"]
        self.form_entry_font = FONTS["small"]
        self.small_font = FONTS["tiny"]
        self.bold_font = FONTS["button"]

        # Shared card styles used when rendering person blocks
        styles = make_card_styles(self.card_bg_color, self.accent_color)
        self.card_lbl_style = styles["lbl"]
        self.card_val_style = styles["val"]
        self.card_accent_lbl = styles["accent_lbl"]
        self.card_accent_small = styles["accent_small"]
        
        # Highlight/flash state trackers to prevent sticky colors on rapid searches
        self._flash_states = {}
        self._flash_counter = 0
        self._pending_flash_id = None
        # Scroll behavior: base offset and fine alignment margin
        self._scroll_top_offset = 80
        self._scroll_view_margin = 12
        # Filters and search navigation state
        self.filter_branch = "All"
        self.filter_manager = "All"
        self.filter_has_bg = False
        self.filter_has_cori = False
        self.filter_has_nh = False
        self.filter_has_me = False
        self.show_unscheduled = True
        self.show_scheduled = True
        self._search_matches = []
        self._search_index = -1
        # Autosave/backups configuration
        self._autosave_interval_ms = 60_000
        self._autosave_after_id = None
        
        # Archiving Configuration
        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.archive_dir = os.path.join(base_dir, "data", "Archive")
        
        self.root.configure(bg=self.bg_color)
        
        # Data Setup
        base_dir = os.path.dirname(os.path.abspath(__file__))
        self.data_dir = os.path.join(base_dir, "data")
        os.makedirs(self.data_dir, exist_ok=True)
        # We still keep directory permissions tight
        try: os.chmod(self.data_dir, 0o700)
        except: pass

        # Exports directory inside data for cleaner workspace
        self.exports_dir = os.path.join(self.data_dir, "exports")
        try:
            os.makedirs(self.exports_dir, exist_ok=True)
        except Exception:
            pass

        # Program auth file for stored (hashed) program password
        self.auth_file = os.path.join(self.data_dir, "prog_auth.json")

        self.data_file = os.path.join(self.data_dir, "workflow_data.json")
        self.enc_file = os.path.join(self.data_dir, "workflow_data.json.enc")
        
        self.people_data = [] # List of dictionaries
        self.security = None
        self.master_password = None
        
        # Security Flow
        if not self.run_security_check():
            self.root.destroy()
            return
        
        # Load Data
        self.load_data()
        # One-time migration to add invisible codes and canonicalize dropdown values
        try:
            self._migrate_codes()
        except Exception:
            pass
        
        # Create UI
        self.create_widgets()
        self.refresh_blocks()
        # Apply chrome fonts and readable text to filters at startup
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
        except Exception:
            pass

    # Utility: create a styled button and pack it (reduces repeated code)
    # Removed local _make_button; use shared pack_action_button from ui_helpers.

    # Helper to create a labeled grid Entry inside a parent frame and return the Entry widget
    def _label_and_entry(self, parent, label_text, row, label_col=0, entry_col=1, colspan=1, entry_kwargs=None):
        tk.Label(parent, text=f"{label_text}:", bg=self.bg_color, fg=self.fg_color, font=self.form_label_font).grid(row=row, column=label_col, sticky="w", pady=5)
        # Use themed card background and foreground for all form entries
        field_bg = getattr(self, 'card_bg_color', CURRENT_PALETTE.get('card_bg_color', '#ffffff'))
        entry = tk.Entry(parent, font=self.form_entry_font, bg=field_bg, fg=self.fg_color, insertbackground=self.fg_color, **(entry_kwargs or {}))
        entry.grid(row=row, column=entry_col, columnspan=colspan, sticky="ew", padx=(10, 0), pady=5)
        return entry

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
                try:
                    with open(self.data_file, 'r', encoding='utf-8') as f:
                        self.people_data = json.load(f)
                except Exception:
                    with open(self.data_file, 'r') as f:
                        self.people_data = json.load(f)
                self.save_data()
                os.remove(self.data_file)
                show_info(self.root, "Success", "Database migrated and encrypted successfully.")
            except Exception as e:
                show_error(self.root, "Error", f"Migration failed: {e}")
                return False

        # --- Normal load: decrypt existing encrypted DB if present ---
        if os.path.exists(self.enc_file):
            try:
                decrypted_json = self.security.decrypt(self.enc_file)
                if decrypted_json:
                    self.people_data = json.loads(decrypted_json)
                else:
                    raise Exception("Decryption returned empty or failed.")
            except Exception as e:
                show_error(self.root, "Load Error", f"Could not decrypt/load data:\n{str(e)}")
                self.people_data = []
        else:
            self.people_data = []

        return True

    def load_data(self):
        """Load data from encrypted JSON file"""
        if os.path.exists(self.enc_file):
            try:
                if not self.security:
                    raise Exception("Security manager is not initialized.")
                decrypted_json = self.security.decrypt(self.enc_file)
                if decrypted_json:
                    self.people_data = json.loads(decrypted_json)
                else:
                    raise Exception("Decryption returned empty or failed.")
            except Exception as e:
                show_error(self.root, "Load Error", f"Could not decrypt/load data:\n{str(e)}")
                self.people_data = []
        else:
            self.people_data = []

    def _migrate_codes(self):
        """Backfill code fields and canonicalize display values for dropdowns."""
        if not isinstance(self.people_data, list):
            return
        code_maps = {
            'CORI Status': [("None","NONE"),("Required","REQ"),("Submitted","SUB"),("Cleared","CLR")],
            'NH GC Status': [("None","NONE"),("Required","REQ"),("Cleared","CLR")],
            'ME GC Status': [("None","NONE"),("Required","REQ"),("Sent to Denise","SEND")],
            'Deposit Account Type': [("",""),("Checking","CHK"),("Savings","SAV")],
            'Shirt Size': [("6XL","6XL"),("5XL","5XL"),("4XL","4XL"),("3XL","3XL"),("2XL","2XL"),("XL","XL"),("LG","LG"),("MD","MD"),("SM","SM"),("XS","XS")],
        }
        def norm(s):
            return ''.join(ch for ch in (s or '').lower() if ch.isalnum())
        def canonicalize(field, val):
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
                for disp, _ in code_maps['Shirt Size']:
                    if norm(disp) == n:
                        return disp
                return t or 'MD'
            return t
        def code_from_display(field, display):
            pairs = code_maps.get(field, [])
            for disp, c in pairs:
                if (display or '').strip().lower() == disp.lower():
                    return c
            return ''
        def display_from_code(field, code):
            pairs = code_maps.get(field, [])
            for disp, c in pairs:
                if (code or '').strip().upper() == c.upper():
                    return disp
            return None
        fields = ['CORI Status', 'NH GC Status', 'ME GC Status', 'Deposit Account Type', 'Shirt Size']
        for person in self.people_data:
            if not isinstance(person, dict):
                continue
            for field in fields:
                code_key = f"{field}_Code"
                disp = person.get(field, '')
                code = person.get(code_key, '')
                # Prefer existing code to set display
                if code:
                    disp_from_code = display_from_code(field, code)
                    if disp_from_code:
                        person[field] = disp_from_code
                else:
                    # Canonicalize display, then backfill code
                    canon = canonicalize(field, disp)
                    person[field] = canon
                    person[code_key] = code_from_display(field, canon)

    def save_data(self):
        """Save data to encrypted JSON file"""
        try:
            json_str = json.dumps(self.people_data, indent=4)
            if not self.security:
                raise Exception("Security manager is not initialized.")
            if not self.security.encrypt(json_str, self.enc_file):
                raise Exception("OpenSSL encryption process failed.")
        except Exception as e:
            show_error(self.root, "Save Error", f"Could not encrypt/save data:\n{str(e)}")

    def create_widgets(self):
        # Title Frame
        self.title_frame = tk.Frame(self.root, bg=self.accent_color, height=70)
        self.title_frame.pack(fill=tk.X, pady=(0, 10))
        self.title_frame.pack_propagate(False)
        
        self.title_label = tk.Label(
            self.title_frame,
            text="Candidate Tracker",
            font=FONTS["title"],
            bg=self.accent_color,
            fg="white"
        )
        self.title_label.pack(side=tk.LEFT, padx=20)
        
        # Search Box (Name lookup) via shared helper + Prev/Next
        self.search_var = tk.StringVar()
        self.search_entry, self.search_container = build_search_bar(self.title_frame, self.search_var, self.search_person)
        # Arrow-only buttons with charcoal styling; auto-size to text
        pack_action_button(self.search_container, "<", self.search_prev, role="charcoal", font=FONTS["button"], padx=2)
        pack_action_button(self.search_container, ">", self.search_next, role="charcoal", font=FONTS["button"], padx=2)
        # Add Filters toggle to the right of search group
        toggle_txt = tk.StringVar(value="Hide Filters")
        def _toggle_filters():
            self._filters_visible = not self._filters_visible
            toggle_txt.set("Show Filters" if not self._filters_visible else "Hide Filters")
            self._animate_filters(self._filters_visible)
        btn_toggle = pack_action_button(self.search_container, toggle_txt.get(), _toggle_filters, role="charcoal", font=FONTS["button"], padx=6)
        def _sync_btn_text(*_):
            try:
                btn_toggle.config(text=toggle_txt.get())
            except Exception:
                pass
        toggle_txt.trace_add("write", _sync_btn_text)
        
        # Add Button in Title Bar
        pack_action_button(self.title_frame, "+ Add Person", self.open_add_dialog, role="add", font=FONTS["button"], width=14, side=tk.RIGHT, padx=10)
        
        # Compact stacked Export/Archives group to the right
        # Right-side stacked action column; match ribbon color
        self._title_stack = tk.Frame(self.title_frame, bg=getattr(self, 'ribbon_color', self.accent_color))
        self._title_stack.pack(side=tk.RIGHT, padx=8)
        # Longer single-line labels per preference; keep compact padding
        pack_action_button(self._title_stack, "Export CSV", self.export_current_view_csv, role="view", font=FONTS["micro_bold"], width=18, compact=True, side=tk.TOP)
        pack_action_button(self._title_stack, "View Archives", self.open_archive_viewer, role="view", font=FONTS["micro_bold"], width=18, compact=True, side=tk.TOP, pady=2)
        # Change Program Password (wider, edit color)
        pack_action_button(self.title_frame, "Change Password", self.change_program_password, role="edit", font=FONTS["button"], width=20, side=tk.RIGHT, padx=10)
        # Theme toggle button (updates label on switch)
        try:
            current = getattr(self, '_current_theme', 'light')
            btn_txt = f"Theme: {current.capitalize()}"
            # Make the theme toggle wider and reduce side padding
            self._theme_btn = pack_action_button(self.title_frame, btn_txt, self.toggle_theme, role="charcoal", font=FONTS["button"], width=20, side=tk.RIGHT, padx=4)
        except Exception:
            self._theme_btn = None

        # Filters Bar (collapsible with slide animation)
        self._filters_visible = True
        # Filters container for slide animation
        self.filters_container = tk.Frame(self.root, bg=self.bg_color, height=1)
        self.filters_container.pack(side=tk.BOTTOM, fill=tk.X, padx=20, pady=(0, 6))
        self.filters_container.pack_propagate(False)
        self.filters_frame = tk.Frame(self.filters_container, bg=self.bg_color)
        self.filters_frame.pack(fill=tk.X)
        tk.Label(self.filters_frame, text="Branch:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT)
        self._branch_var = tk.StringVar(value=self.filter_branch)
        branch_vals = ["All", "Salem", "Portland"]
        ttk.Combobox(self.filters_frame, textvariable=self._branch_var, values=branch_vals, state="readonly", width=10).pack(side=tk.LEFT, padx=(6, 12))
        tk.Label(self.filters_frame, text="Mgr:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT)
        self._manager_var = tk.StringVar(value=self.filter_manager)
        mgr_vals = ["All"] + sorted(list({(p.get("Manager Name") or '').strip() for p in self.people_data if p.get("Manager Name")}))
        ttk.Combobox(self.filters_frame, textvariable=self._manager_var, values=mgr_vals, state="readonly", width=18).pack(side=tk.LEFT, padx=(6, 12))
        self._bg_var = tk.BooleanVar(value=self.filter_has_bg)
        self._cori_var = tk.BooleanVar(value=self.filter_has_cori)
        self._nh_var = tk.BooleanVar(value=self.filter_has_nh)
        self._me_var = tk.BooleanVar(value=self.filter_has_me)
        tk.Checkbutton(self.filters_frame, text="BG", variable=self._bg_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(4, 8))
        tk.Checkbutton(self.filters_frame, text="CORI", variable=self._cori_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(4, 8))
        tk.Checkbutton(self.filters_frame, text="NH GC", variable=self._nh_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(4, 8))
        tk.Checkbutton(self.filters_frame, text="ME GC", variable=self._me_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(4, 8))
        self._unsched_var = tk.BooleanVar(value=self.show_unscheduled)
        self._sched_var = tk.BooleanVar(value=self.show_scheduled)
        tk.Checkbutton(self.filters_frame, text="Show Unscheduled", variable=self._unsched_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(12, 8))
        tk.Checkbutton(self.filters_frame, text="Show Scheduled", variable=self._sched_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(4, 8))
        # Apply Filters as charcoal to match search and arrows
        pack_action_button(self.filters_frame, "Apply Filters", self._apply_filters_and_refresh, role="charcoal", font=FONTS["button"], side=tk.RIGHT, padx=10)

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
        self.container.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
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
        self.dashboard_frame.columnconfigure(0, weight=2) # Left - Unscheduled (Compact) - Expanded
        self.dashboard_frame.columnconfigure(1, weight=3) # Right - Scheduled (Detailed)
        
        self.left_col = tk.Frame(self.dashboard_frame, bg=self.bg_color)
        self.left_col.grid(row=0, column=0, sticky="nsew", padx=(0, 10))
        
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
            # If initial theme is dark and a stylesheet exists, apply it
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dark_path = os.path.join(base_dir, 'dark_mode.json')
            light_path = os.path.join(base_dir, 'light_theme.json')
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
            pal = None
            if self._current_theme == 'dark' and os.path.exists(dark_path):
                pal = apply_stylesheet(self.root, dark_path, refs)
            elif self._current_theme == 'light' and os.path.exists(light_path):
                pal = apply_stylesheet(self.root, light_path, refs)
            if not pal:
                pal = get_palette(self._current_theme)
            apply_palette(self.root, pal, refs)
            # Update chrome tokens (fonts + button role colors)
            try:
                from ui_helpers import apply_chrome_tokens
                apply_chrome_tokens(refs)
            except Exception:
                pass
            # Update local color tokens from palette
            self.bg_color = pal['bg_color']
            self.fg_color = pal['fg_color']
            self.accent_color = pal['accent_color']
            self.ribbon_color = pal.get('ribbon_color', pal['accent_color'])
            self.button_color = pal['button_color']
            self.error_color = pal['error_color']
            self.warning_color = pal['warning_color']
            self.card_bg_color = pal['card_bg_color']
            # Recompute card styles after accent/card bg set
            self._recompute_styles()
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
            for w in (self.title_frame, self.filters_container, self.filters_frame, self.container, self.scrollable_frame):
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
                if self.search_container:
                    self.search_container.configure(bg=getattr(self, 'ribbon_color', self.accent_color))
                if getattr(self, '_title_stack', None) is not None:
                    self._title_stack.configure(bg=getattr(self, 'ribbon_color', self.accent_color))
            except Exception:
                pass
            # Recompute styles used by person blocks and refresh
            self._recompute_styles()
            self.refresh_blocks()
        except Exception:
            pass

    def toggle_theme(self):
        """Toggle between light and dark themes across available engines."""
        try:
            new_t = 'light' if (getattr(self, '_current_theme', 'light') == 'dark') else 'dark'
            # Apply engine theme via helpers
            self._tb_style = set_engine_theme(self.root, self._theme_engine, new_t, self._tb_style)
            self._current_theme = new_t
            # Get palette and apply across UI
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dark_path = os.path.join(base_dir, 'dark_mode.json')
            light_path = os.path.join(base_dir, 'light_theme.json')
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
            if self._current_theme == 'dark' and os.path.exists(dark_path):
                pal = apply_stylesheet(self.root, dark_path, refs)
                if not pal:
                    pal = get_palette(self._current_theme)
            elif self._current_theme == 'light' and os.path.exists(light_path):
                pal = apply_stylesheet(self.root, light_path, refs)
                if not pal:
                    pal = get_palette(self._current_theme)
            else:
                pal = reset_stylesheet(self.root, refs, theme=self._current_theme)
            apply_palette(self.root, pal, refs)
            # Update chrome tokens (fonts + button role colors)
            try:
                from ui_helpers import apply_chrome_tokens
                apply_chrome_tokens(refs)
            except Exception:
                pass
            # Update local color tokens from palette
            self.bg_color = pal['bg_color']
            self.fg_color = pal['fg_color']
            self.accent_color = pal['accent_color']
            self.ribbon_color = pal.get('ribbon_color', pal['accent_color'])
            self.button_color = pal['button_color']
            self.error_color = pal['error_color']
            self.warning_color = pal['warning_color']
            self.card_bg_color = pal['card_bg_color']
            # Recompute styles and refresh blocks
            self._recompute_styles()
            self.refresh_blocks()
            # Update button label if present
            try:
                btn = getattr(self, '_theme_btn', None)
                if btn is not None:
                    btn.config(text=f"Theme: {self._current_theme.capitalize()}")
            except Exception:
                pass
            # Persist preference (1=light, 2=dark)
            try:
                pref_path = os.path.join(base_dir, 'data', 'theme_pref.json')
                val = 2 if self._current_theme == 'dark' else 1
                with open(pref_path, 'w', encoding='utf-8') as f:
                    json.dump({"theme": val}, f)
            except Exception:
                pass
            try:
                self.root.update_idletasks()
            except Exception:
                pass
        except Exception:
            pass

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
        widget.bind("<MouseWheel>", callback)
        widget.bind("<Button-4>", callback)
        widget.bind("<Button-5>", callback)
        for child in widget.winfo_children():
            self.bind_mousewheel(child, callback)

    def _on_frame_configure(self, event):
        """Reset the scroll region to encompass the inner frame and adjust width"""
        self.canvas.configure(scrollregion=self.canvas.bbox("all"))
        # Adjust the window width to match the canvas
        self.canvas.itemconfig(self.canvas_window, width=event.width - 40)

    def _on_mousewheel(self, event):
        if event.num == 4 or event.delta > 0:
            self.canvas.yview_scroll(-1, "units")
        elif event.num == 5 or event.delta < 0:
            self.canvas.yview_scroll(1, "units")

    def refresh_blocks(self):
        """Clear and rebuild the blocks with dual-column sorting"""
        # Clear columns
        for widget in self.left_col.winfo_children():
            widget.destroy()
        for widget in self.right_col.winfo_children():
            widget.destroy()
        # Reset card registry used for searching
        self.card_registry = []
            
        if not self.people_data:
            lbl = tk.Label(
                self.right_col,
                text="No people added yet. Click '+ Add Person' to start.",
                font=FONTS["muted_bold"],
                bg=self.bg_color,
                fg="#95a5a6"
            )
            lbl.pack(pady=50)
            return

        # Split into Scheduled and Unscheduled
        scheduled = []
        unscheduled = []
        
        for person in self.people_data:
            if person.get("NEO Scheduled Date", "").strip():
                scheduled.append(person)
            else:
                unscheduled.append(person)

        # Sort Scheduled: Date then Name
        def get_scheduled_key(person):
            date_str = person.get("NEO Scheduled Date", "").strip()
            try:
                date_obj = datetime.strptime(date_str, "%m/%d/%Y")
            except:
                date_obj = datetime(9999, 12, 31)
            return (date_obj, person.get("Name", "").strip().lower())

        scheduled.sort(key=get_scheduled_key)
        
        # Sort Unscheduled: Name
        unscheduled.sort(key=lambda p: p.get("Name", "").strip().lower())

        # Apply filters
        scheduled = [p for p in scheduled if self._passes_filters(p, scheduled=True)] if self.show_scheduled else []
        unscheduled = [p for p in unscheduled if self._passes_filters(p, scheduled=False)] if self.show_unscheduled else []

        # Headers for columns
        tk.Label(self.left_col, text="UNSCHEDULED", font=FONTS["subtext_bold"], bg=self.bg_color, fg="#e74c3c").pack(pady=(10, 5), anchor="w")
        tk.Label(self.right_col, text="SCHEDULED NEO", font=FONTS["subtext_bold"], bg=self.bg_color, fg="#27ae60").pack(pady=(10, 5), anchor="w")

        # Create blocks in Left Column (Compact)
        for person in unscheduled:
            # We need the original index for editing/deleting
            # Let's find it in self.people_data
            orig_idx = self.people_data.index(person)
            self.create_person_block(orig_idx, person, self.left_col, compact=True)
            
        # Create blocks in Right Column (Detailed)
        for person in scheduled:
            orig_idx = self.people_data.index(person)
            self.create_person_block(orig_idx, person, self.right_col, compact=False)
        
        # Re-bind mousewheel
        self.bind_mousewheel(self.root, self._on_mousewheel)

    def create_person_block(self, index, person, parent_frame, compact=False):
        """Create a person block, either compact (Name/Reqs) or detailed"""
        # Create a "Card" for the person
        card = tk.Frame(parent_frame, bg=self.card_bg_color, bd=0, relief=tk.FLAT)
        # Remove internal vertical padding that created an empty area below each card
        # Keep external spacing between cards using pady only
        card.pack(fill=tk.X, pady=5)

        # Register this card for search by name
        try:
            name_key = (person.get('Name', '') or '').strip().lower()
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
        header_frame.pack(fill=tk.X, padx=10 if compact else 15, pady=(2, 2) if compact else (5, 5))
        
        name_label = person.get('Name', 'Unknown').upper()
        if not compact:
            name_label = f"{name_label}    EID {person.get('Employee ID', 'N/A')}"
            
        tk.Label(header_frame, text=name_label, **header_val_style).pack(side=tk.LEFT)

        # Buttons (Edit only for compact, Full set for detailed)
        btn_frame = tk.Frame(header_frame, bg=self.card_bg_color)
        btn_frame.pack(side=tk.RIGHT)
        
        if compact:
            # compact view: Edit, Delete
            pack_action_button(btn_frame, "Edit", lambda i=index: self.open_edit_dialog(i), role="edit", font=FONTS["button"], width=10)
            pack_action_button(btn_frame, "Delete", lambda i=index: self.delete_person(i), role="delete", font=FONTS["button"], width=10)
        else:
            # detailed view: Archive, Edit, Delete
            pack_action_button(btn_frame, "Archive", lambda i=index: self.archive_person(i), role="archive", font=FONTS["button"], width=10)
            pack_action_button(btn_frame, "Edit", lambda i=index: self.open_edit_dialog(i), role="edit", font=FONTS["button"], width=10)
            pack_action_button(btn_frame, "Delete", lambda i=index: self.delete_person(i), role="delete", font=FONTS["button"], width=10)

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
        content_box.pack(fill=tk.X, padx=10 if compact else 15, pady=5)

        # Requirements Section (Compact or Detailed)
        req_frame = tk.Frame(content_box, bg=self.bg_color)
        req_frame.pack(fill=tk.X, padx=5, pady=5)
        
        tk.Label(req_frame, text="Required Items:", font=FONTS["tiny_bold"] if compact else FONTS["small"], bg=self.bg_color, fg="#1a3a5a").pack(side=tk.LEFT, padx=5)
        
        # Hardcoded requirements (others like CORI are handled dynamically)
        requirements = [
            ("Drug Test", "Drug Test"), ("Onboarding", "Onboarding Packets"), 
            ("I-9 Section", "I-9 Section 1")
        ]
        
        active_reqs = []
        for data_key, label in requirements:
            if person.get(data_key):
                active_reqs.append(label)

        # --- DYNAMIC CLEARANCES LOGIC ---
        clearances = []
        
        # BG Check
        bg_date = person.get("Background Completion Date", "").strip()
        if bg_date:
            clearances.append(f"BG CHECK Cleared: {bg_date}")
            active_reqs.append("BG")
        
        # CORI (display only when cleared)
        cori_status = person.get("CORI Status", "None")
        cori_sub_date = person.get("CORI Submit Date", "").strip()
        cori_clr_date = person.get("CORI Cleared Date", "").strip()
        if cori_status == "Cleared":
            disp = "CORI Cleared"
            if cori_clr_date: disp += f": {cori_clr_date}"
            if cori_sub_date: disp += f" (Sub: {cori_sub_date})"
            clearances.append(disp)
            active_reqs.append("CORI")

        # NH GC
        nh_status = person.get("NH GC Status", "None")
        nh_id = person.get("NH GC ID Number", "").strip()
        nh_exp = person.get("NH GC Expiration Date", "").strip()
        if nh_status == "Required":
            clearances.append("NH GC Required")
        elif nh_status == "Cleared":
            disp = f"NH GC Cleared ID:{nh_id}" if nh_id else "NH GC Cleared"
            if nh_exp: disp += f" EXP:{nh_exp}"
            clearances.append(disp)
            active_reqs.append("NH GC")

        # ME GC
        me_status = person.get("ME GC Status", "None")
        me_sent = person.get("ME GC Sent Date", "").strip()
        if me_status == "Required":
            clearances.append("ME GC Required")
        elif me_status == "Sent to Denise":
            disp = "ME GC Sent to Denise"
            if me_sent: disp += f" ({me_sent})"
            clearances.append(disp)
            active_reqs.append("ME GC")

        # Others
        if person.get("MVR"): clearances.append("MVR Cleared")
        if person.get("DOD Clearance"): clearances.append("DOD Clearance")
        if person.get("ME Guard License Sent"): clearances.append("ME Guard License Sent")
        
        if active_reqs:
            req_text = " • ".join(active_reqs)
            tk.Label(req_frame, text=req_text, bg=self.bg_color, fg="#3498db", font=FONTS["tiny_bold"] if compact else FONTS["tiny"], wraplength=400 if compact else 800).pack(side=tk.LEFT, padx=5)
        # Quick CORI status displayed next to Requirements (right-aligned)
        cori_state = person.get("CORI Status", "None")
        if cori_state == "Cleared":
            tk.Label(req_frame, text="CORI CLEARED", bg=self.bg_color, fg="#1a3a5a", font=FONTS["muted_bold"]).pack(side=tk.RIGHT, padx=5)

        if compact:
            # Add a bottom border and END HERE for compact
            tk.Frame(card, height=1, bg="#bdc3c7").pack(fill=tk.X, pady=(5, 0))
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
        add_separator(col1, color="#bdc3c7", pady=(2, 4))
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
            add_separator(col2, color="#bdc3c7", pady=(4, 4))

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
                add_separator(col2, color="#bdc3c7", pady=(6, 4))

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
        add_separator(col3, color="#bdc3c7", pady=(6, 4))

        # Emergency Contact section with consistent styling
        build_section_header(col3, "Emergency Contact", accent_lbl_style).pack(anchor="w")
        ec_name = f"{person.get('EC First Name','')} {person.get('EC Last Name','')}".strip()
        if ec_name:
            create_kv_row(col3, "Name", ec_name, lbl_style, val_style, self.card_bg_color)
            create_kv_row(col3, "Rel", person.get('EC Relationship',''), lbl_style, val_style, self.card_bg_color)
            create_kv_row(col3, "Phone", person.get('EC Phone Number',''), lbl_style, val_style, self.card_bg_color)
        else:
            muted = lbl_style.copy(); muted["fg"] = "#7f8c8d"
            tk.Label(col3, text="Not Provided", **muted).pack(anchor="w")

        # Uniform Sub-row
        build_uniform_row(col3, person, bg=self.bg_color)

        # Notes Section (Row 4, spans all columns)
        notes = person.get("Notes", "").strip()
        if notes:
            notes_frame = tk.Frame(details_container, bg=self.card_bg_color, bd=1, relief=tk.GROOVE, padx=10, pady=5)
            notes_frame.pack(fill=tk.X, expand=True, padx=3, pady=(5,0))
            tk.Label(notes_frame, text="Additional Notes:", font=FONTS["tiny_bold"], bg=self.card_bg_color, fg="#7f8c8d").pack(anchor="w")
            tk.Label(notes_frame, text=notes, font=FONTS["tiny"], bg=self.card_bg_color, wraplength=800, justify=tk.LEFT).pack(anchor="w")

        # Bottom Border
        add_separator(card, color="#bdc3c7", pady=(10, 0))

    # --- Search & Scroll Helpers ---
    def search_person(self):
        """Find the first card whose name contains the query and scroll to it."""
        query = (self.search_var.get() or '').strip().lower()
        if not query:
            return
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
    def _apply_filters_and_refresh(self):
        try:
            self.filter_branch = (self._branch_var.get() or 'All').strip()
        except Exception:
            self.filter_branch = 'All'
        try:
            self.filter_manager = (self._manager_var.get() or 'All').strip()
        except Exception:
            self.filter_manager = 'All'
        try:
            self.filter_has_bg = bool(self._bg_var.get())
            self.filter_has_cori = bool(self._cori_var.get())
            self.filter_has_nh = bool(self._nh_var.get())
            self.filter_has_me = bool(self._me_var.get())
        except Exception:
            pass
        try:
            self.show_unscheduled = bool(self._unsched_var.get())
            self.show_scheduled = bool(self._sched_var.get())
        except Exception:
            pass
        self.refresh_blocks()

    def _passes_filters(self, person, scheduled=False):
        # Branch filter
        if (self.filter_branch or 'All') != 'All':
            if (person.get('Branch', '') or '').strip().lower() != (self.filter_branch or '').strip().lower():
                return False
        # Manager filter
        if (self.filter_manager or 'All') != 'All':
            if (person.get('Manager Name', '') or '').strip().lower() != (self.filter_manager or '').strip().lower():
                return False
        # BG filter: require completion date present
        if self.filter_has_bg:
            if not (person.get('Background Completion Date', '') or '').strip():
                return False
        # CORI filter: require Cleared only
        if self.filter_has_cori:
            if (person.get('CORI Status', 'None') or 'None') != 'Cleared':
                return False
        # NH GC filter: require Cleared
        if self.filter_has_nh:
            if (person.get('NH GC Status', 'None') or 'None') != 'Cleared':
                return False
        # ME GC filter: require Sent to Denise or Cleared
        if self.filter_has_me:
            if (person.get('ME GC Status', 'None') or 'None') not in ('Sent to Denise', 'Cleared'):
                return False
        return True

    def export_current_view_csv(self):
        """Prompt to export either the filtered view or the entire workspace to CSV."""
        if not (self.people_data or []):
            show_info(self.root, 'Export CSV', 'No people found to export.')
            return

        choice = None
        try:
            choice = show_message_dialog(
                self.root,
                'Export CSV',
                'Choose export scope:',
                buttons=[
                    {'text': 'Export Filtered View', 'role': 'continue', 'value': 'filtered', 'width': 22},
                    {'text': 'Export Entire Workspace', 'role': 'save', 'value': 'all', 'width': 24},
                    {'text': 'Cancel', 'role': 'cancel', 'value': None}
                ],
                default_role='continue'
            )
        except Exception:
            # Fallback to exporting all if dialog fails
            choice = 'all'
        if not choice:
            return

        def person_to_row(p):
            return {
                'Scheduled': 'Yes' if (p.get('NEO Scheduled Date', '') or '').strip() else 'No',
                'Name': p.get('Name', ''),
                'Employee ID': p.get('Employee ID', ''),
                'ICIMS ID': p.get('ICIMS ID', ''),
                'Job Name': p.get('Job Name', ''),
                'Job Location': p.get('Job Location', ''),
                'Manager Name': p.get('Manager Name', ''),
                'Branch': p.get('Branch', ''),
                'NEO Scheduled Date': p.get('NEO Scheduled Date', ''),
                'Background Completion Date': p.get('Background Completion Date', ''),
                'CORI Status': p.get('CORI Status', ''),
                'CORI Submit Date': p.get('CORI Submit Date', ''),
                'CORI Cleared Date': p.get('CORI Cleared Date', ''),
                'NH GC Status': p.get('NH GC Status', ''),
                'NH GC ID Number': p.get('NH GC ID Number', ''),
                'NH GC Expiration Date': p.get('NH GC Expiration Date', ''),
                'ME GC Status': p.get('ME GC Status', ''),
                'ME GC Sent Date': p.get('ME GC Sent Date', ''),
                'MVR': 'Yes' if p.get('MVR') else 'No',
                'DOD Clearance': 'Yes' if p.get('DOD Clearance') else 'No',
                'Deposit Account Type': p.get('Deposit Account Type', ''),
                'Bank Name': p.get('Bank Name', ''),
                'Routing Number': p.get('Routing Number', ''),
                'Account Number': p.get('Account Number', ''),
                'Candidate Phone Number': p.get('Candidate Phone Number', ''),
                'Candidate Email': p.get('Candidate Email', ''),
            }

        rows = []
        if choice == 'filtered':
            # Build rows using current filters (mirrors refresh_blocks logic)
            scheduled = []
            unscheduled = []
            for person in self.people_data:
                if (person.get('NEO Scheduled Date', '') or '').strip():
                    scheduled.append(person)
                else:
                    unscheduled.append(person)

            def get_scheduled_key(p):
                date_str = (p.get('NEO Scheduled Date', '') or '').strip()
                try:
                    date_obj = datetime.strptime(date_str, '%m/%d/%Y')
                except Exception:
                    date_obj = datetime(9999, 12, 31)
                return (date_obj, (p.get('Name', '') or '').strip().lower())

            scheduled.sort(key=get_scheduled_key)
            unscheduled.sort(key=lambda p: (p.get('Name', '') or '').strip().lower())

            if self.show_scheduled:
                scheduled = [p for p in scheduled if self._passes_filters(p, scheduled=True)]
            else:
                scheduled = []
            if self.show_unscheduled:
                unscheduled = [p for p in unscheduled if self._passes_filters(p, scheduled=False)]
            else:
                unscheduled = []

            for p in unscheduled:
                rows.append(person_to_row(p))
            for p in scheduled:
                rows.append(person_to_row(p))
        else:
            # Export all people, ignore filters
            rows = [person_to_row(p) for p in (self.people_data or [])]

        if not rows:
            show_info(self.root, 'Export CSV', 'No rows to export for current view.')
            return

        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        suffix = 'filtered' if choice == 'filtered' else 'all'
        # Ensure exports folder exists
        try:
            os.makedirs(self.exports_dir, exist_ok=True)
        except Exception:
            pass
        out_path = os.path.join(self.exports_dir, f'export_{suffix}_{ts}.csv')
        try:
            with open(out_path, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                writer.writeheader()
                writer.writerows(rows)
        except Exception as e:
            show_error(self.root, 'Export CSV', f'Failed to write CSV: {e}')
            return
        try:
            rel = os.path.relpath(out_path, start=os.path.dirname(os.path.abspath(__file__)))
        except Exception:
            rel = out_path
        # Confirmation with quick actions
        msg = f"Exported {len(rows)} rows to:\n{rel}"
        try:
            action = show_message_dialog(
                self.root,
                'Export Complete',
                msg,
                buttons=[
                    {'text': 'Open File Location', 'role': 'view', 'value': 'open'},
                    {'text': 'View CSV', 'role': 'continue', 'value': 'view'},
                    {'text': 'Close', 'role': 'cancel', 'value': None}
                ],
                default_role='continue'
            )
        except Exception:
            action = None
        if action == 'open':
            try:
                self._open_path_in_file_manager(os.path.dirname(out_path))
            except Exception:
                pass
        elif action == 'view':
            try:
                self._view_csv_file(out_path)
            except Exception as e:
                show_error(self.root, 'CSV Viewer', f'Unable to open CSV:\n{e}')

    # --- Autosave & Backups ---
    def _schedule_autosave(self):
        try:
            if self._autosave_after_id:
                self.root.after_cancel(self._autosave_after_id)
        except Exception:
            pass
        try:
            interval = int(getattr(self, '_autosave_interval_ms', 60_000))
        except Exception:
            interval = 60_000
        self._autosave_after_id = self.root.after(interval, self._perform_autosave)

    def _perform_autosave(self):
        try:
            self.save_data()
        except Exception:
            pass
        # Rolling backups: keep last 10 encrypted snapshots in data/Backups
        backups_dir = os.path.join(self.data_dir, 'Backups')
        try:
            os.makedirs(backups_dir, exist_ok=True)
        except Exception:
            pass
        # Copy encrypted file with timestamp if it exists
        if os.path.exists(self.enc_file):
            ts = datetime.now().strftime('%Y%m%d_%H%M%S')
            dest = os.path.join(backups_dir, f'workflow_data_{ts}.enc')
            try:
                shutil.copy2(self.enc_file, dest)
            except Exception:
                pass
        # Prune to last 10 by modified time
        try:
            files = [os.path.join(backups_dir, fn) for fn in os.listdir(backups_dir) if fn.endswith('.enc')]
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

    def _view_csv_file(self, file_path):
        """Simple CSV viewer in-app using a Treeview with scrollbars."""
        win = tk.Toplevel(self.root)
        win.title(f"CSV Viewer: {os.path.basename(file_path)}")
        bg = self.bg_color
        win.configure(bg=bg)
        win.geometry("900x500")
        win.transient(self.root)
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
        pack_action_button(btn_bar, 'Close', win.destroy, role='cancel', font=FONTS['button'], width=10, side=tk.RIGHT)

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
            offset = max(0, int(getattr(self, "_scroll_top_offset", 80)))
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
                    desired = max(0, int(getattr(self, "_scroll_view_margin", 12)))
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

    def _flash_widget(self, root_widget, highlight="#fff3bf", hold_ms=100, fade_ms=1000, fade_steps=20):
        """Gentle highlight: one-time highlight, hold for ~1s, then fade out ~1s.
        Robust against rapid re-triggers and restores original colors.
        """
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
        ArchiveViewer(self.root, self.archive_dir)
        
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
            self.people_data.pop(index)
            self.save_data()
            self.refresh_blocks()

    def archive_person(self, index):
        person = self.people_data[index]
        
        # 1. Validation for Required Fields
        req_name = person.get("Name", "").strip()
        req_eid = person.get("Employee ID", "").strip()
        req_neo = person.get("NEO Scheduled Date", "").strip()

        if not all([req_name, req_eid, req_neo]):
            show_error(self.root, "Error", "Cannot archive! Go back and make sure the required fields are filled out.")
            return

        if not ask_yes_no(self.root, "Confirm Archive", f"Archive {req_name} and remove from active list?\n(PII like SSN and ID numbers will be stripped)"):
            return

        try:
            # 2. Extract Data (Stripping PII)
            # We exclude: Social, DOB, ID No., Exp., Other ID
            exclude_fields = ["Social", "DOB", "ID No.", "Exp.", "Other ID", "State ID", "Driver's License", "Pass Port"]
            
            # 3. Prompt for NEO Hours
            start_time = simpledialog.askstring("NEO Hours", f"Enter Start Time for {req_name} (e.g., 0800):")
            end_time = simpledialog.askstring("NEO Hours", f"Enter End Time for {req_name} (e.g., 1700):")
            
            total_hours = "N/A"
            if start_time and end_time:
                try:
                    # Clean inputs
                    s = start_time.replace(":", "").strip()
                    e = end_time.replace(":", "").strip()
                    
                    if len(s) == 4 and len(e) == 4:
                        s_mins = int(s[:2]) * 60 + int(s[2:])
                        e_mins = int(e[:2]) * 60 + int(e[2:])
                        total_hours = round((e_mins - s_mins) / 60.0, 2)
                except:
                    pass

            # 4. Format Archive Content (TRIMMED)
            # Only include: Name, EID, Hire Date, NEO Hours, Job Name, Job Location, Branch, Sizes
            now = datetime.now()
            # Build a human-friendly, sectioned archive body
            parts = []
            parts.append(f"FILE ARCHIVED: {now.strftime('%m-%d-%Y %H%M')}")
            parts.append("")
            parts.append("== Candidate Info ==")
            parts.append(f"Name: {req_name}")
            parts.append(f"Employee ID: {req_eid}")
            parts.append(f"Hire Date (NEO): {req_neo}")
            parts.append(f"Job Name: {person.get('Job Name', 'N/A')}")
            parts.append(f"Job Location: {person.get('Job Location', 'N/A')}")
            parts.append(f"Branch: {person.get('Branch', 'N/A')}")
            parts.append("")
            parts.append("== NEO Hours ==")
            parts.append(f"Start: {start_time if start_time else 'N/A'}")
            parts.append(f"End:   {end_time if end_time else 'N/A'}")
            parts.append(f"Total Hours: {total_hours}")
            parts.append("")
            parts.append("== Uniform Sizes ==")
            parts.append(f"Shirt: {person.get('Shirt Size', 'N/A')}")
            parts.append(f"Pants: {person.get('Pants Size', 'N/A')}")
            parts.append(f"Boots: {person.get('Boots Size', 'N/A')}")
            parts.append("")
            # Optional notes (kept short)
            notes_text = (person.get('Notes') or '').strip()
            if notes_text:
                parts.append("== Notes ==")
                parts.extend([line.rstrip() for line in notes_text.splitlines()])
                parts.append("")

            parts.append("-" * 40)
            file_body = "\n".join(parts)

            # 4. Zip Encryption Logic
            # Create data/Archive if not exists
            os.makedirs(self.archive_dir, exist_ok=True)
            
            # Parse year and month for folder structure
            try:
                # Assuming MM/DD/YYYY format
                parts = req_neo.split('/')
                h_month = parts[0]
                h_year = parts[2]
                
                m_name = MONTHS.get(h_month, "Unknown_Month")
                month_folder = f"{h_month}_{m_name}"
            except:
                # Fallback to current date if parsing fails
                h_year = now.strftime("%Y")
                month_folder = now.strftime("%m_%B")

            # Temporary file paths
            clean_name = re.sub(r'[^a-zA-Z0-9]', '_', req_name)
            temp_month_path = os.path.join(self.archive_dir, month_folder)
            os.makedirs(temp_month_path, exist_ok=True)
            
            temp_file_name = f"{clean_name}.txt"
            temp_file_path = os.path.join(temp_month_path, temp_file_name)
            
            with open(temp_file_path, 'w', encoding='utf-8', newline='\n') as f:
                f.write(file_body)

            # Archive filename (encrypted .zip container)
            archive_file = f"{h_year}.zip"
            # Prompt for archive password (per-archive, one-time)
            arch_dialog = ArchivePasswordDialog(self.root, prompt=f"Set password for archive {archive_file}:", default=(self.master_password or ""))
            self.root.wait_window(arch_dialog)
            if not arch_dialog.result:
                show_info(self.root, "Cancelled", "Archive cancelled: no password provided.")
                shutil.rmtree(temp_month_path)
                return
            archive_password = arch_dialog.result


            # Create a zip archive in memory, then encrypt with OpenSSL-compatible AES-256-CBC
            import io, zipfile
            archive_full = os.path.join(self.archive_dir, archive_file)
            try:
                # Read existing archive if present, else create new
                zip_buffer = io.BytesIO()
                if os.path.exists(archive_full):
                    # Decrypt existing archive
                    sec = SecurityManager(archive_password)
                    with open(archive_full, 'rb') as f:
                        enc_data = f.read()
                    # Try fast in-process decrypt; fall back to OpenSSL CLI on error
                    try:
                        dec_data = sec._decrypt_bytes_with_lib(enc_data) if sec._lib else None
                    except Exception:
                        dec_data = None
                    if dec_data is None:
                        # fallback to CLI
                        import subprocess
                        proc = subprocess.run([
                            "openssl", "aes-256-cbc", "-d", "-pbkdf2", "-iter", "100000",
                            "-k", archive_password, "-in", archive_full
                        ], capture_output=True, check=True)
                        dec_data = proc.stdout
                    zip_buffer.write(dec_data)
                    zip_buffer.seek(0)
                    mode = 'a'
                else:
                    mode = 'w'
                # Write new file into zip
                with zipfile.ZipFile(zip_buffer, mode=mode, compression=zipfile.ZIP_DEFLATED) as z:
                    arcname = f"{month_folder}/{temp_file_name}".replace('\\', '/')
                    z.write(temp_file_path, arcname)
                # Encrypt the zip buffer
                sec = SecurityManager(archive_password)
                zip_buffer.seek(0)
                # Try fast in-process encrypt; fall back to OpenSSL CLI on error
                try:
                    enc_data = sec._encrypt_bytes_with_lib(zip_buffer.read()) if sec._lib else None
                except Exception:
                    enc_data = None
                if enc_data is None:
                    # fallback to CLI
                    import subprocess
                    proc = subprocess.Popen([
                        "openssl", "aes-256-cbc", "-e", "-pbkdf2", "-iter", "100000",
                        "-k", archive_password, "-out", archive_full
                    ], stdin=subprocess.PIPE)
                    proc.communicate(input=zip_buffer.getvalue())
                    if proc.returncode != 0:
                        raise Exception("OpenSSL encryption failed")
                else:
                    with open(archive_full, 'wb') as f:
                        f.write(enc_data)
            except Exception as e:
                raise Exception(f"Archive creation failed: {e}")

            # 5. Cleanup
            shutil.rmtree(temp_month_path)
            
            # 6. Finalize: Remove from data and refresh
            self.people_data.pop(index)
            self.save_data()
            self.refresh_blocks()
            
            show_info(self.root, "Success", f"Successfully archived {req_name} to {archive_file}")

        except Exception as e:
            show_error(self.root, "Archive Failure", f"An error occurred during archiving:\n{str(e)}")

    def show_person_dialog(self, person=None, index=None):
        dialog = tk.Toplevel(self.root)
        dialog.title("Edit Person" if person else "Add Person")
        dialog.configure(bg=self.bg_color)
        dialog.resizable(False, False) # Non-resizable as requested
        dialog.transient(self.root)
        dialog.grab_set()
        
        entries = {}
        checkbox_vars = {}
        branch_var = tk.StringVar(value=person.get("Branch", "Salem") if person else "Salem")
        
        # Robust combobox setter to match saved values (case/space-insensitive)
        def _set_combo_value(combo, var, value):
            try:
                vals = list(combo['values'])
                target = (value or '').strip()
                idx = None
                for i, v in enumerate(vals):
                    if str(v).strip().lower() == target.lower():
                        idx = i
                        break
                if idx is not None:
                    combo.current(idx)
                else:
                    # Fallback: set text directly
                    var.set(target)
                    combo.set(target)
            except Exception:
                try:
                    var.set(value or '')
                    combo.set(value or '')
                except Exception:
                    pass

        # Canonicalize saved/edit values to allowed options per field
        def _canonicalize(field, val):
            t = (val or '').strip()
            t_low = t.lower()
            def norm(s):
                return ''.join(ch for ch in s.lower() if ch.isalnum())
            n = norm(t)
            if field in ("CORI Status", "NH GC Status", "ME GC Status"):
                # Common status tokens
                if 'req' in n:
                    return 'Required'
                if 'sub' in n:
                    return 'Submitted' if field == 'CORI Status' else ('Required' if 'sub' in n else 'None')
                if 'clear' in n or 'clr' in n:
                    return 'Cleared'
                if field == 'ME GC Status' and ('sent' in n and 'denise' in n or 'senttodenise' in n):
                    return 'Sent to Denise'
                if 'none' in n or t == '':
                    return 'None'
                # Fallback: return original (might already be valid)
                return t
            if field == 'Deposit Account Type':
                if 'saving' in n:
                    return 'Savings'
                if 'check' in n:
                    return 'Checking'
                return '' if t == '' else t
            if field == 'Shirt Size':
                sizes = ["6XL", "5XL", "4XL", "3XL", "2XL", "XL", "LG", "MD", "SM", "XS"]
                for s in sizes:
                    if norm(s) == n:
                        return s
                return t or 'MD'
            return t

        # --- Invisible index codes for robust persistence ---
        code_maps = {
            'CORI Status': [("None","NONE"),("Required","REQ"),("Submitted","SUB"),("Cleared","CLR")],
            'NH GC Status': [("None","NONE"),("Required","REQ"),("Cleared","CLR")],
            'ME GC Status': [("None","NONE"),("Required","REQ"),("Sent to Denise","SEND")],
            'Deposit Account Type': [("",""),("Checking","CHK"),("Savings","SAV")],
            'Shirt Size': [("6XL","6XL"),("5XL","5XL"),("4XL","4XL"),("3XL","3XL"),("2XL","2XL"),("XL","XL"),("LG","LG"),("MD","MD"),("SM","SM"),("XS","XS")],
        }
        # Helper to get display from code map
        def _display_from_code(field, code):
            pairs = code_maps.get(field, [])
            for disp, c in pairs:
                if (code or '').strip().upper() == c.upper():
                    return disp
            return None
        def _code_from_display(field, display):
            pairs = code_maps.get(field, [])
            for disp, c in pairs:
                if (display or '').strip().lower() == disp.lower():
                    return c
            return ''
        # Store combobox widgets and maps for saving codes
        combo_code_widgets = {}
        
        # Main Container (Directly in dialog now, no scroll)
        content_frame = tk.Frame(dialog, bg=self.bg_color, padx=25, pady=20)
        content_frame.pack(fill=tk.BOTH, expand=True)

        # (Header row removed per layout change)

        # Main Layout Container
        main_form = tk.Frame(content_frame, bg=self.bg_color)
        main_form.pack(fill=tk.BOTH, expand=True)
        
        # --- LEFT COLUMN ---
        left_col = tk.Frame(main_form, bg=self.bg_color)
        left_col.pack(side=tk.LEFT, fill=tk.BOTH, expand=True, padx=(0, 20), anchor="n")
        left_col.columnconfigure(0, weight=1)
        
        # Basic Information Section
        basic_lframe = tk.LabelFrame(
            left_col, 
            text=" Basic Information ", 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        basic_lframe.grid(row=0, column=0, sticky="nsew", pady=(0, 10))
        basic_lframe.columnconfigure(1, weight=1)

        fields = [
            ("Name", "Name"), ("ICIMS ID", "ICIMS ID"), ("Employee ID", "Employee ID"),
            ("Job Name", "Job Name"), ("Job Location", "Job Location"), 
            ("Manager Name", "Manager Name"), ("NEO Scheduled Date", "NEO Scheduled Date")
        ]
        for i, (label, key) in enumerate(fields):
            entry = self._label_and_entry(basic_lframe, label, i, label_col=0, entry_col=1)
            if person and key in person:
                entry.insert(0, person[key])
            entries[key] = entry

        # Branch radio buttons (Inside Basic Info)
        tk.Label(basic_lframe, text="Branch:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).grid(row=7, column=0, sticky="w", pady=5)
        branch_frame = tk.Frame(basic_lframe, bg=self.bg_color)
        branch_frame.grid(row=7, column=1, sticky="w", padx=(10, 0), pady=5)
        
        branch_var = tk.StringVar(value=person.get("Branch", "Salem") if person else "Salem")
        entries["Branch_var"] = branch_var
        for branch in ["Salem", "Portland"]:
            tk.Radiobutton(branch_frame, text=branch, variable=branch_var, value=branch, bg=self.bg_color, fg=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), activebackground=self.bg_color, activeforeground=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(0, 10))

        # Contact Info Section
        contact_lframe = tk.LabelFrame(
            left_col, 
            text=" Contact info ", 
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
        phone_entry.config(width=15)
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
            text=" Personal info ", 
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
        other_entry = tk.Entry(id_checks_frame, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color, width=15)
        other_entry.pack(side=tk.LEFT)
        if person and "Other ID" in person:
            other_entry.insert(0, person["Other ID"])
        entries["Other ID"] = other_entry

        # Row 2: Basic Identity Fields
        personal_fields = ["State", "ID No.", "Exp.", "DOB", "Social"]
        for i, field in enumerate(personal_fields):
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
            base_dir = os.path.dirname(os.path.abspath(__file__))
            dark_path = os.path.join(base_dir, 'dark_mode.json')
            light_path = os.path.join(base_dir, 'light_theme.json')
            refs = {
                'container': content_frame,
                'scrollable_frame': main_form,
                'left_col': left_col,
                'right_col': right_col,
            }
            pal = None
            if getattr(self, '_current_theme', 'light') == 'dark' and os.path.exists(dark_path):
                pal = apply_stylesheet(dialog, dark_path, refs)
            elif getattr(self, '_current_theme', 'light') == 'light' and os.path.exists(light_path):
                pal = apply_stylesheet(dialog, light_path, refs)
            if not pal:
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
            text=" Licensing & Clearance ", 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        license_lframe.grid(row=1, column=0, sticky="nsew", pady=(0, 10))
        license_lframe.columnconfigure(1, weight=1)
        
        # Remove "CORI Submitted or Cleared Date" from lic_fields
        lic_fields = [
            ("NH GC ID Number", "NH GC ID Number"),
            ("NH GC Expiration Date", "NH GC Expiration Date"),
            ("Background Completion Date", "Background Completion Date")
        ]
        
        for i, (label, key) in enumerate(lic_fields):
            entry = self._label_and_entry(license_lframe, label, i, label_col=0, entry_col=1)
            if person and key in person:
                entry.insert(0, person[key])
            entries[key] = entry

        # --- EMERGENCY CONTACT SECTION ---
        emergency_lframe = tk.LabelFrame(
            right_col, 
            text=" Emergency Contact ", 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        emergency_lframe.grid(row=0, column=0, sticky="nsew", pady=(0, 10))
        emergency_lframe.columnconfigure(1, weight=1)

        emergency_fields = [
            ("First Name", "EC First Name"),
            ("Last Name", "EC Last Name"),
            ("Relationship", "EC Relationship"),
            ("Phone Number", "EC Phone Number")
        ]

        for i, (label, data_key) in enumerate(emergency_fields):
            entry = self._label_and_entry(emergency_lframe, label, i, label_col=0, entry_col=1)
            if person and data_key in person:
                entry.insert(0, person[data_key])
            entries[data_key] = entry

        # --- CLEARANCES SECTION (In Right Column) ---
        status_lframe = tk.LabelFrame(
            right_col, 
            text=" Licensing & Clearances ", 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
            padx=10, 
            pady=10
        )
        status_lframe.grid(row=1, column=0, sticky="nsew", pady=(0, 8))
        status_lframe.columnconfigure(1, weight=1)
        
        # BG Date + inline MVR and DOD checkboxes
        tk.Label(status_lframe, text="BG CLEAR Date:", bg=self.bg_color, font=FONTS["tiny_bold"]).grid(row=0, column=0, sticky="w", pady=5)
        bg_row = tk.Frame(status_lframe, bg=self.bg_color)
        bg_row.grid(row=0, column=1, sticky="w", padx=5)
        bg_entry = tk.Entry(bg_row, font=FONTS["small"], width=10, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        bg_entry.pack(side=tk.LEFT)
        if person: bg_entry.insert(0, person.get("Background Completion Date", ""))
        entries["Background Completion Date"] = bg_entry
        # MVR and DOD inline next to BG date
        mvr_var = tk.BooleanVar(value=person.get("MVR", False) if person else False)
        checkbox_vars["MVR"] = mvr_var
        tk.Checkbutton(bg_row, text="MVR", variable=mvr_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT, padx=(8,0))
        dod_var = tk.BooleanVar(value=person.get("DOD Clearance", False) if person else False)
        checkbox_vars["DOD Clearance"] = dod_var
        tk.Checkbutton(bg_row, text="DOD Clearance", variable=dod_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT, padx=(8,0))

        tk.Frame(status_lframe, height=1, bg="#bdc3c7").grid(row=1, column=0, columnspan=2, sticky="ew", pady=5)

        # CORI Section (checkboxes)
        tk.Label(status_lframe, text="CORI:", bg=self.bg_color, font=FONTS["small"]).grid(row=2, column=0, sticky="w")
        cori_opts = tk.Frame(status_lframe, bg=self.bg_color)
        cori_opts.grid(row=2, column=1, sticky="w")
        cori_req_var = tk.BooleanVar(value=(person.get("CORI Required", False) if person else False) or ((person.get("CORI Status", "None") if person else "None") == "Required"))
        cori_sub_var = tk.BooleanVar(value=(person.get("CORI Submitted", False) if person else False) or ((person.get("CORI Status", "None") if person else "None") == "Submitted"))
        cori_clr_var = tk.BooleanVar(value=(person.get("CORI Cleared", False) if person else False) or ((person.get("CORI Status", "None") if person else "None") == "Cleared"))
        checkbox_vars["CORI Required"] = cori_req_var
        checkbox_vars["CORI Submitted"] = cori_sub_var
        checkbox_vars["CORI Cleared"] = cori_clr_var
        tk.Checkbutton(cori_opts, text="Required", variable=cori_req_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT)
        tk.Checkbutton(cori_opts, text="Submitted", variable=cori_sub_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT, padx=(8,0))
        tk.Checkbutton(cori_opts, text="Cleared", variable=cori_clr_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT, padx=(8,0))
        
        tk.Label(status_lframe, text="CORI Date (Sub/Clr):", bg=self.bg_color, font=FONTS["tiny"]).grid(row=3, column=0, sticky="w")
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

        tk.Frame(status_lframe, height=1, bg="#bdc3c7").grid(row=4, column=0, columnspan=2, sticky="ew", pady=5)

        # --- NH/ME GC Two-Column Layout ---
        gc_frame = tk.Frame(status_lframe, bg=self.bg_color)
        gc_frame.grid(row=5, column=0, columnspan=2, sticky="ew")
        # NH GC Column
        nh_col = tk.Frame(gc_frame, bg=self.bg_color)
        nh_col.pack(side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 10))
        tk.Label(nh_col, text="NH GC:", bg=self.bg_color, font=FONTS["small"]).pack(anchor="w")
        nh_opts = tk.Frame(nh_col, bg=self.bg_color)
        nh_opts.pack(anchor="w")
        nh_req_var = tk.BooleanVar(value=(person.get("NH GC Required", False) if person else False) or ((person.get("NH GC Status", "None") if person else "None") == "Required"))
        nh_clr_var = tk.BooleanVar(value=(person.get("NH GC Cleared", False) if person else False) or ((person.get("NH GC Status", "None") if person else "None") == "Cleared"))
        checkbox_vars["NH GC Required"] = nh_req_var
        checkbox_vars["NH GC Cleared"] = nh_clr_var
        tk.Checkbutton(nh_opts, text="Required", variable=nh_req_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT)
        tk.Checkbutton(nh_opts, text="Cleared", variable=nh_clr_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT, padx=(8,0))
        # NH ID / Exp under NH GC
        tk.Label(nh_col, text="NH ID / Exp:", bg=self.bg_color, font=FONTS["tiny"]).pack(anchor="w")
        nh_details = tk.Frame(nh_col, bg=self.bg_color)
        nh_details.pack(anchor="w")
        ent_nh_id = tk.Entry(nh_details, font=FONTS["tiny"], width=15, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
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
        tk.Label(me_col, text="ME GC:", bg=self.bg_color, font=FONTS["small"]).pack(anchor="w")
        me_opts = tk.Frame(me_col, bg=self.bg_color)
        me_opts.pack(anchor="w")
        me_req_var = tk.BooleanVar(value=(person.get("ME GC Required", False) if person else False) or ((person.get("ME GC Status", "None") if person else "None") == "Required"))
        me_send_var = tk.BooleanVar(value=(person.get("ME GC Sent", False) if person else False) or ((person.get("ME GC Status", "None") if person else "None") == "Sent to Denise"))
        checkbox_vars["ME GC Required"] = me_req_var
        checkbox_vars["ME GC Sent"] = me_send_var
        tk.Checkbutton(me_opts, text="Required", variable=me_req_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT)
        tk.Checkbutton(me_opts, text="Sent to Denise", variable=me_send_var, bg=self.bg_color, fg=self.fg_color, activeforeground=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), font=FONTS["tiny"]).pack(side=tk.LEFT, padx=(8,0))
        tk.Label(me_col, text="ME Sent Date:", bg=self.bg_color, font=FONTS["tiny"]).pack(anchor="w")
        ent_me_date = tk.Entry(me_col, font=FONTS["tiny"], width=12, bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        ent_me_date.pack(anchor="w")
        if person: ent_me_date.insert(0, person.get("ME GC Sent Date", ""))
        entries["ME GC Sent Date"] = ent_me_date

        # Removed ME Guard License Sent; DOD/MVR moved inline with BG date

        # --- DIRECT DEPOSIT SECTION ---
        dd_lframe = tk.LabelFrame(
            right_col,
            text=" Direct Deposit Info ",
            font=FONTS["subheader"],
            bg=self.bg_color,
            fg="#1a3a5a",
            padx=10,
            pady=10
        )
        dd_lframe.grid(row=2, column=0, sticky="nsew", pady=(6, 8))
        dd_lframe.columnconfigure(1, weight=1)

        # Account Type (checkboxes with exclusivity)
        tk.Label(dd_lframe, text="Account Type:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).grid(row=0, column=0, sticky="w", pady=5)
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
        bank_entry = self._label_and_entry(dd_lframe, "Bank Name", 1, label_col=0, entry_col=1)
        if person and "Bank Name" in person:
            bank_entry.insert(0, person["Bank Name"])
        entries["Bank Name"] = bank_entry

        # Routing Number
        rtng_entry = self._label_and_entry(dd_lframe, "Rtng", 2, label_col=0, entry_col=1)
        if person and "Routing Number" in person:
            rtng_entry.insert(0, person["Routing Number"])
        entries["Routing Number"] = rtng_entry

        # Account Number
        acct_entry = self._label_and_entry(dd_lframe, "Acct", 3, label_col=0, entry_col=1)
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
            text=" Uniforms & Clothing: ", 
            font=FONTS["subheader"], 
            bg=self.bg_color, 
            fg="#1a3a5a", 
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
        pants_entry = tk.Entry(sizing_container, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color, width=8)
        pants_entry.pack(side=tk.LEFT, padx=5)
        if person and "Pants Size" in person:
            pants_entry.insert(0, person["Pants Size"])
        entries["Pants Size"] = pants_entry

        tk.Label(sizing_container, text="BOOTS", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).pack(side=tk.LEFT, padx=(10, 0))
        boots_entry = tk.Entry(sizing_container, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color, width=8)
        boots_entry.pack(side=tk.LEFT, padx=5)
        if person and "Boots Size" in person:
            boots_entry.insert(0, person["Boots Size"])
        entries["Boots Size"] = boots_entry

        # Apply lighter sky-blue header color for later-created label frames
        try:
            is_dark = _is_dark_color(getattr(self, 'bg_color', '#000000'))
            header_fg = '#4ea0ff' if is_dark else '#87CEEB'
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
        tk.Checkbutton(uniform_lframe, text="Uniform issued during NEO", variable=issued_var, bg=self.bg_color, fg=self.fg_color, selectcolor=CURRENT_PALETTE.get('checkbox_select_color', '#000000'), activebackground=self.bg_color, activeforeground=self.fg_color, font=FONTS["small"]).grid(row=1, column=0, columnspan=2, sticky="w", pady=5)

        # Articles Given
        tk.Label(uniform_lframe, text="articles given:", bg=self.bg_color, fg=self.fg_color, font=FONTS["small"]).grid(row=2, column=0, sticky="w", pady=5)
        articles_entry = tk.Entry(uniform_lframe, font=FONTS["small"], bg=self.card_bg_color, fg=self.fg_color, insertbackground=self.fg_color)
        articles_entry.grid(row=2, column=1, sticky="ew", padx=(10, 0), pady=5)
        if person and "Articles Given" in person:
            articles_entry.insert(0, person["Articles Given"])
        entries["Articles Given"] = articles_entry
        # Footer buttons: Cancel and +SAVE on bottom-right
        footer_frame = tk.Frame(content_frame, bg=self.bg_color)
        footer_frame.pack(fill=tk.X, pady=(12, 0))
        # Cancel to the right of the footer, then Save (rightmost)
        pack_action_button(footer_frame, "CANCEL", lambda: dialog.destroy(), role="cancel", font=FONTS["button"], width=12, side=tk.RIGHT, padx=10)
        pack_action_button(footer_frame, "+SAVE", lambda: save(), role="save", font=FONTS["button"], width=12, side=tk.RIGHT, padx=10)
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
                self.people_data[index] = new_data
            else:
                self.people_data.append(new_data)
                
            self.save_data()
            self.refresh_blocks()
            dialog.destroy()


def main():
    root = tk.Tk()
    app = WorkflowGUI(root)
    root.mainloop()

if __name__ == "__main__":
    main()
