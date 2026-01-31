"""
Unified configuration and constants for the Workflow application.
Centralizes typography, colors, button styles, and application constants.
"""

# ============================================================================
# TYPOGRAPHY TOKENS
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

# Default palette (light)
CURRENT_PALETTE = LIGHT_PALETTE.copy()

# ============================================================================
# BUTTON ROLE COLORS
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

# Roles that should always render black text
ALWAYS_BLACK_TEXT_ROLES = {"add", "view", "delete"}

# Button styling constants
BUTTON_OUTLINE_COLOR = "#1b1f23"
BUTTON_DEFAULT_WIDTH = 12
BUTTON_INTERNAL_PADX = 3
BUTTON_INTERNAL_PADY = 2
BUTTON_PACK_IPADY = 1

# ============================================================================
# DIALOG LAYOUT CONSTANTS
# ============================================================================
DIALOG_MIN_WIDTH = 420
DIALOG_MAX_WIDTH = 780
DIALOG_WRAP_RATIO = 0.65
DIALOG_PADX = 24
DIALOG_PADY = 20

# ============================================================================
# WORKFLOW APPLICATION CONSTANTS
# ============================================================================
MONTHS = {
    '01': 'January', '02': 'February', '03': 'March', '04': 'April',
    '05': 'May', '06': 'June', '07': 'July', '08': 'August',
    '09': 'September', '10': 'October', '11': 'November', '12': 'December'
}

# Password hashing parameters
PASSWORD_ITERATIONS = 200_000
PASSWORD_SALT_BYTES = 16

# Encryption parameters
ENCRYPTION_ITERATIONS = 100_000
ENCRYPTION_CIPHER = "aes-256-cbc"
ENCRYPTION_PBKDF2 = "-pbkdf2"

# OpenSSL command configuration
OPENSSL_CMD = "openssl"

# Security/encryption header format
ENCRYPTION_HEADER = b'PBKDF2v1'
ENCRYPTION_KEY_BYTES = 32
ENCRYPTION_IV_BYTES = 16

# Scroll behavior
SCROLL_TOP_OFFSET = 80
SCROLL_VIEW_MARGIN = 12

# Autosave interval (milliseconds)
AUTOSAVE_INTERVAL_MS = 60_000

# Directory structure
REQUIRED_DIRECTORIES = ["data", "data/exports", "data/Archive"]
DIRECTORY_PERMISSIONS = 0o700

# Archive file extension
ARCHIVE_EXTENSION = ".zip"

# ============================================================================
# WEEKLY TRACKER CONSTANTS
# ============================================================================
WEEKDAY_NAMES = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"]
WORK_WEEK_DAYS = 7

# ============================================================================
# FIELD MAPPINGS & CODES
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

# Status field names requiring canonicalization
STATUS_FIELDS = ['CORI Status', 'NH GC Status', 'ME GC Status', 'Deposit Account Type', 'Shirt Size']

# ============================================================================
# DROPDOWN VALUES
# ============================================================================
BRANCH_OPTIONS = ["All", "Salem", "Portland"]

# ============================================================================
# FILE NAMES & PATHS
# ============================================================================
AUTH_FILE_NAME = "prog_auth.json"
DATA_FILE_NAME = "workflow_data.json"
DATA_FILE_ENC_NAME = "workflow_data.json.enc"
ARCHIVE_DIR_NAME = "Archive"
EXPORTS_DIR_NAME = "exports"
THEME_PREF_FILE = "data/theme_pref.json"

# Theme constants
THEME_LIGHT = "light"
THEME_DARK = "dark"
THEME_LIGHT_CODE = 1
THEME_DARK_CODE = 2

# Default window sizes
DEFAULT_WINDOW_WIDTH = 1500
DEFAULT_WINDOW_HEIGHT = 1000
ARCHIVE_VIEWER_WIDTH = 900
ARCHIVE_VIEWER_HEIGHT = 650
# CSV export field mapping
CSV_EXPORT_FIELDS = [
    'Scheduled', 'Name', 'Employee ID', 'ICIMS ID', 'Job Name', 'Job Location',
    'Manager Name', 'Branch', 'NEO Scheduled Date', 'Background Completion Date',
    'CORI Status', 'CORI Submit Date', 'CORI Cleared Date',
    'NH GC Status', 'NH GC ID Number', 'NH GC Expiration Date',
    'ME GC Status', 'ME GC Sent Date', 'MVR', 'DOD Clearance',
    'Deposit Account Type', 'Bank Name', 'Routing Number', 'Account Number',
    'Candidate Phone Number', 'Candidate Email',
]

# Filter field mappings
FILTER_CONFIG = {
    'branch': {'default': 'All', 'field': 'Branch'},
    'manager': {'default': 'All', 'field': 'Manager Name'},
    'bg': {'field': 'Background Completion Date', 'status': 'Cleared'},
    'cori': {'field': 'CORI Status', 'status': 'Cleared'},
    'nh_gc': {'field': 'NH GC Status', 'status': 'Cleared'},
    'me_gc': {'field': 'ME GC Status', 'statuses': ['Sent to Denise', 'Cleared']},
}

# Status value constants
STATUS_NONE = "None"
STATUS_REQUIRED = "Required"
STATUS_SUBMITTED = "Submitted"
STATUS_CLEARED = "Cleared"
STATUS_SENT_TO_DENISE = "Sent to Denise"

# Status field labels
CORI_LABEL = "CORI"
NH_GC_LABEL = "NH GC"
ME_GC_LABEL = "ME GC"
BG_LABEL = "BG"
MVR_LABEL = "MVR"
DOD_LABEL = "DOD"

# ============================================================================
# FORM FIELD DEFINITIONS
# ============================================================================
# Basic information fields (dialog form)
BASIC_INFO_FIELDS = [
    ("Name", "Name"),
    ("ICIMS ID", "ICIMS ID"),
    ("Employee ID", "Employee ID"),
    ("Job Name", "Job Name"),
    ("Job Location", "Job Location"),
    ("Manager Name", "Manager Name"),
    ("NEO Scheduled Date", "NEO Scheduled Date"),
]

# License/clearance fields
LICENSE_FIELDS = [
    ("NH GC ID Number", "NH GC ID Number"),
    ("NH GC Expiration Date", "NH GC Expiration Date"),
    ("Background Completion Date", "Background Completion Date"),
]

# Emergency contact fields
EMERGENCY_CONTACT_FIELDS = [
    ("First Name", "EC First Name"),
    ("Last Name", "EC Last Name"),
    ("Relationship", "EC Relationship"),
    ("Phone Number", "EC Phone Number"),
]

# Personal ID fields
PERSONAL_ID_FIELDS = ["State", "ID No.", "Exp.", "DOB", "Social"]

# Requirements for person block display
REQUIRED_ITEMS = [
    ("Drug Test", "Drug Test"),
    ("Onboarding", "Onboarding Packets"),
    ("I-9 Section", "I-9 Section 1"),
]

# Person block info bar fields (displayed in detailed view)
PERSON_BLOCK_INFO_FIELDS = [
    ("Icims:", "ICIMS ID"),
    ("Job:", "Job Name"),
    ("Loc:", "Job Location"),
    ("Mgr:", "Manager Name"),
    ("Branch:", "Branch"),
]

# Archive text sections
ARCHIVE_SECTIONS = {
    'candidate_info': "Candidate Info",
    'neo_hours': "NEO Hours",
    'uniform_sizes': "Uniform Sizes",
    'notes': "Notes",
}

# NEO status badge colors
NEO_BADGE_COLORS = {
    'today': ("#39FF14", "black"),     # Neon Green
    'future': ("#27ae60", "black"),    # Light Green
    'default': ("#f1c40f", "black"),   # Yellow
}

# Uniform status constants
UNIFORM_STATUS_ISSUED = "ISSUED"
UNIFORM_STATUS_NOT_ISSUED = "NOT ISSUED"
UNIFORM_STATUS_ISSUED_COLOR = "#27ae60"
UNIFORM_STATUS_NOT_ISSUED_COLOR = "#e74c3c"
# ============================================================================
# DIALOG SECTION TITLES
# ============================================================================
DIALOG_SECTIONS = {
    'basic_info': " Basic Information ",
    'contact_info': " Contact info ",
    'personal_info': " Personal info ",
    'license_clearance': " Licensing & Clearance ",
    'emergency_contact': " Emergency Contact ",
    'clearances': " Licensing & Clearances ",
    'direct_deposit': " Direct Deposit Info ",
    'requirements': " Requirements ",
    'notes': " Notes ",
}

# Dialog field labels
DIALOG_FIELD_LABELS = {
    'branch': "Branch:",
    'other_id': "Other:",
    'bg_date': "BG CLEAR Date:",
    'cori': "CORI:",
    'cori_date': "CORI Date (Sub/Clr):",
    'nh_gc': "NH GC:",
    'nh_id_exp': "NH ID / Exp:",
    'me_gc': "ME GC:",
    'me_sent_date': "ME Sent Date:",
    'account_type': "Account Type:",
    'bank_name': "Bank Name:",
    'routing': "Routing Number:",
    'account': "Account Number:",
}

# Clearance checkbox labels
CLEARANCE_LABELS = {
    'mvr': "MVR",
    'dod': "DOD Clearance",
    'required': "Required",
    'submitted': "Submitted",
    'cleared': "Cleared",
    'sent_to_denise': "Sent to Denise",
}

# ============================================================================
# UI STYLING & DIMENSIONS
# ============================================================================
# Semantic color overrides for specific UI elements
SEPARATOR_COLOR = "#bdc3c7"                    # Light gray separator lines
LABEL_MUTED_COLOR = "#7f8c8d"                  # Muted gray for disabled/secondary text
LABEL_DARK_BLUE = "#1a3a5a"                    # Dark blue for emphasis text (CORI CLEARED)

# Widget dimensions (magic numbers consolidated)
WIDGET_WIDTHS = {
    'branch_combo': 10,                        # Branch combobox width
    'manager_combo': 18,                       # Manager combobox width
    'search_entry': 22,                        # Search bar entry width
    'form_entry_small': 8,                     # Small form entries (time, sizes)
    'form_entry_medium': 10,                   # Medium form entries (dates)
    'form_entry_large': 15,                    # Large form entries (IDs)
}

BUTTON_WIDTHS = {
    'dialog_button': 9,                       # Confirm/Cancel buttons in dialogs
    'dialog_action': 8,                       # Save/Cancel in person dialog
    'action_button': 8,                       # Edit/Delete/Archive buttons (increased to prevent text truncation)
    'export_button': 8,                       # Export CSV button
    'tools_button': 16,                       # Change Password, Theme buttons
}

# Frame dimensions
FRAME_DIMENSIONS = {
    'title_frame_height': 70,                  # Title bar height
    'paned_sash_width': 4,                     # PanedWindow sash width
    'canvas_window_width': 960,                # Main canvas scrollable area width
    'left_pane_width': 300,                    # Left pane width in main UI
}

# Text wrapping dimensions
TEXT_WRAPLENGTHS = {
    'compact_card': 400,                       # Compact person card text wrap
    'full_card': 800,                          # Full person card text wrap
}

# Common padding values (dy, dx tuples used throughout)
PADDING = {
    'default': (4, 4),                         # Standard separator padding
    'tight': (2, 4),                           # Tight spacing
    'loose': (6, 4),                           # Loose spacing
    'section_top': (10, 0),                    # Top of section spacing
    'inline': (4, 8),                          # Between inline widgets
    'info_bar': (2, 0),                        # Info bar padding
    'badge': (2, 10),                          # NEO badge padding
}

# Horizontal padding constants
PADDING_H = {
    'tight': 4,                                # Tight horizontal padding
    'standard': 6,                             # Standard horizontal padding
    'medium': 10,                              # Medium horizontal padding
    'loose': 15,                               # Loose horizontal padding
}

# ============================================================================
# TEXT COLORS & EMPHASIS STYLING
# ============================================================================
# Semantic text colors (separate from palette - used for specific elements)
TEXT_COLORS = {
    'label_muted': "#7f8c8d",                  # Muted gray for disabled/secondary text
    'label_dark_blue': "#1a3a5a",              # Dark blue for emphasis (CORI CLEARED)
    'label_light_blue': "#87CEEB",             # Light blue for dialog headers (dark theme)
    'label_header_blue': "#4ea0ff",            # Header blue (dark theme)
    'section_unscheduled': "#e74c3c",          # Red for unscheduled items
    'section_scheduled': "#27ae60",            # Green for scheduled items
}

# Flash animation colors
FLASH_COLORS = {
    'highlight': "#fff3bf",                    # Pale yellow for highlight
    'hold_ms': 100,                            # Hold time in milliseconds
    'fade_ms': 1000,                           # Fade duration in milliseconds
    'fade_steps': 20,                          # Number of fade steps
}

# Label text constants
LABEL_TEXT = {
    'required_items': "Required Items:",
    'unscheduled_section': "UNSCHEDULED",
    'scheduled_section': "SCHEDULED NEO",
    'uniform_issued': "Uniform issued during NEO",
    'section_uniforms': " Uniforms & Clothing: ",
}


