import tkinter as tk
from tkinter import ttk
from datetime import datetime
import config

# Import typography and constants from config
FONTS = config.FONTS

# Track the currently applied palette (stylesheet-driven)
CURRENT_PALETTE = config.LIGHT_PALETTE.copy()

# Standard dialog layout constants
DIALOG_MIN_WIDTH = config.DIALOG_MIN_WIDTH
DIALOG_MAX_WIDTH = config.DIALOG_MAX_WIDTH
DIALOG_WRAP_RATIO = config.DIALOG_WRAP_RATIO
DIALOG_PADX = config.DIALOG_PADX
DIALOG_PADY = config.DIALOG_PADY

# Button sizing defaults
BUTTON_DEFAULT_WIDTH = config.BUTTON_DEFAULT_WIDTH
BUTTON_INTERNAL_PADX = config.BUTTON_INTERNAL_PADX
BUTTON_INTERNAL_PADY = config.BUTTON_INTERNAL_PADY
BUTTON_PACK_IPADY = config.BUTTON_PACK_IPADY

_ROLE_COLORS = config.BUTTON_ROLE_COLORS

# Keep defaults to allow resetting when leaving stylesheet-driven modes
DEFAULT_FONTS = FONTS.copy()
DEFAULT_ROLE_COLORS = _ROLE_COLORS.copy()

# Registry to track button roles without attaching custom attributes
BUTTON_ROLE_REGISTRY = {}
BUTTON_OUTLINE_COLOR = config.BUTTON_OUTLINE_COLOR

# Roles that should always render black text for readability
ALWAYS_BLACK_TEXT_ROLES = config.ALWAYS_BLACK_TEXT_ROLES

def register_button_role(button, role="default"):
    """Register a Tk button's role for consistent restyling.

    Use this if you create buttons outside `make_action_button`.
    """
    try:
        BUTTON_ROLE_REGISTRY[button] = role
    except RuntimeError:
        pass


def make_action_button(parent, text, command, role="default", font=None, width=None, compact=False):
    """Create a consistently styled action button using shared role schema."""
    bg, active = _ROLE_COLORS.get(role, _ROLE_COLORS["default"]) 
    # Text color policy: force black for certain roles; otherwise contrast by bg
    if role in ALWAYS_BLACK_TEXT_ROLES:
        fg_color = "black"
    else:
        try:
            is_dark = _is_dark_color(bg)
        except RuntimeError:
            is_dark = True
        fg_color = "white" if is_dark else "black"
    active_fg = fg_color
    if font is None:
        font = FONTS["button"]
    btn = tk.Button(
        parent,
        text=text,
        command=command,
        bg=bg,
        fg=fg_color,
        activebackground=active,
        activeforeground=active_fg,
        font=font,
        relief=tk.SOLID,
        bd=1,
        highlightthickness=1,
        highlightbackground=BUTTON_OUTLINE_COLOR,
        highlightcolor=BUTTON_OUTLINE_COLOR,
        cursor="hand2"
    )
    # Track role in registry for later re-styling
    try:
        BUTTON_ROLE_REGISTRY[btn] = role
    except RuntimeError:
        pass
    # Compact padding for charcoal role; otherwise use defaults
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
    """Create and pack a consistently styled action button.

    This wraps make_action_button and applies uniform sizing+paddings,
    plus caller-provided packing options.
    """
    btn = make_action_button(parent, text, command, role=role, font=font, width=width, compact=compact)
    # sensible defaults for packing
    pack_args = {"side": tk.LEFT, "padx": 3, "ipady": BUTTON_PACK_IPADY}
    pack_args.update(pack_opts)
    btn.pack(**pack_args)
    return btn


def _center_and_topmost(dlg, parent, w=None, h=None):
    """Center the dialog over parent and force topmost.

    If width/height are not provided, use the dialog's requested size
    after content has been laid out.
    """
    try:
        dlg.update_idletasks()
        req_w = dlg.winfo_reqwidth()
        req_h = dlg.winfo_reqheight()
        w = w or req_w or 520
        h = h or req_h or 240
        px = parent.winfo_rootx(); py = parent.winfo_rooty()
        pW = parent.winfo_width() or 600; pH = parent.winfo_height() or 400
        x = px + (pW - w) // 2; y = py + (pH - h) // 2
        dlg.geometry(f"{w}x{h}+{x}+{y}")
        dlg.deiconify(); dlg.wait_visibility(); dlg.attributes("-topmost", True)
    except Exception:
        pass


def show_message_dialog(parent, title, message, buttons=None, default_role="continue"):
    """Styled, topmost, modal message dialog.

    buttons: list of dicts with keys {text, role, value}.
    default_role: role that Enter triggers (falls back to first button).
    Returns the 'value' for the clicked button (or None).
    """
    if buttons is None:
        buttons = [{"text": "OK", "role": "continue", "value": True}]
    dlg = tk.Toplevel(parent)
    dlg.title(title)
    # Use parent bg if available; fallback to light theme
    bg = getattr(parent, "bg_color", "#e2e6e9")
    dlg.configure(bg=bg)
    dlg.resizable(False, False)
    dlg.transient(parent)

    frame = tk.Frame(dlg, bg=bg, padx=DIALOG_PADX, pady=DIALOG_PADY)
    frame.pack(expand=True, fill="both")
    tk.Label(frame, text=title, font=FONTS["subtext_bold"], bg=bg).pack(pady=(0, 8))
    # Create text label and compute scalable width based on content and parent size
    text_lbl = tk.Label(frame, text=message, font=FONTS["body"], bg=bg, justify=tk.LEFT)
    text_lbl.pack()
    try:
        parent.update_idletasks()
        pW = parent.winfo_width() or 800
    except Exception:
        pW = 800
    # Measure unwrapped requested width, then constrain by ratio and max bounds
    text_lbl.configure(wraplength=10000)
    text_lbl.update_idletasks()
    req_text_w = text_lbl.winfo_reqwidth()
    ratio_inner = max(360, min(int(pW * DIALOG_WRAP_RATIO) - DIALOG_PADX * 2, DIALOG_MAX_WIDTH - DIALOG_PADX * 2))
    inner_w = min(max(req_text_w, 360), ratio_inner)
    text_lbl.configure(wraplength=inner_w)
    result = {"value": None}
    bar = tk.Frame(frame, bg=bg); bar.pack(pady=12)

    created = []
    for spec in buttons:
        def mk(val=spec.get("value")):
            return lambda: (result.update({"value": val}), dlg.destroy())
        b = make_action_button(bar, spec.get("text", "OK"), mk(), role=spec.get("role", "default"), font=FONTS["button"], width=spec.get("width")) 
        b.pack(side=tk.LEFT, padx=8); created.append((b, spec.get("role", "default")))

    # Bind Enter -> default_role, Escape -> close/cancel
    target_btn = None
    for b, role in created:
        if role == default_role:
            target_btn = b; break
    if target_btn is None and created:
        target_btn = created[0][0]
    if target_btn is not None:
        dlg.bind("<Return>", lambda e, t=target_btn: t.invoke())
    esc_btn = None
    for b, role in created:
        if role in ("cancel", "delete"):
            esc_btn = b; break
    # If no explicit cancel, Escape closes dialog
    dlg.bind("<Escape>", lambda e: dlg.destroy())

    # Center and enforce topmost after content is laid out, using min/max width bounds
    dlg.update_idletasks()
    req_h = dlg.winfo_reqheight()
    use_w = max(DIALOG_MIN_WIDTH, min(inner_w + DIALOG_PADX * 2, DIALOG_MAX_WIDTH))
    _center_and_topmost(dlg, parent, w=use_w, h=req_h)
    try:
        dlg.grab_set()
    except Exception:
        pass
    dlg.wait_window()
    return result["value"]


def show_error(parent, title, message):
    return show_message_dialog(parent, title, message, buttons=[{"text": "OK", "role": "continue", "value": True}], default_role="continue")


def show_info(parent, title, message):
    return show_message_dialog(parent, title, message, buttons=[{"text": "OK", "role": "continue", "value": True}], default_role="continue")


def show_warning(parent, title, message):
    return show_message_dialog(parent, title, message, buttons=[{"text": "OK", "role": "continue", "value": True}], default_role="continue")


def ask_yes_no(parent, title, message):
    val = show_message_dialog(parent, title, message, buttons=[
        {"text": "Continue", "role": "continue", "value": True},
        {"text": "Cancel", "role": "cancel", "value": False}
    ], default_role="continue")
    return bool(val)


def make_card_styles(card_bg_color: str, accent_color: str):
    """Return a dictionary of shared card styles for labels and values.

    Keys: 'lbl', 'val', 'accent_lbl', 'accent_small'.
    """
    def _hex_to_rgb(h):
        try:
            h = (h or '').strip().lstrip('#')
            if len(h) == 6:
                return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
        except Exception:
            pass
        return (255, 255, 255)
    def _is_dark(h):
        r, g, b = _hex_to_rgb(h)
        # Perceived luminance
        lum = (0.299*r + 0.587*g + 0.114*b) / 255.0
        return lum < 0.5
    dark_bg = _is_dark(card_bg_color)
    lbl_fg = "#cfd8dc" if dark_bg else config.TEXT_COLORS['label_dark_blue']
    val_fg = "#ecf0f1" if dark_bg else "black"
    acc_fg = accent_color
    return {
        "lbl": {"bg": card_bg_color, "fg": lbl_fg, "font": FONTS["tiny"]},
        "val": {"bg": card_bg_color, "fg": val_fg, "font": (FONTS["tiny"][0], FONTS["tiny"][1], "bold")},
        "accent_lbl": {"bg": card_bg_color, "fg": acc_fg, "font": FONTS["subheader"]},
        "accent_small": {"bg": card_bg_color, "fg": lbl_fg, "font": FONTS["small"]},
    }



def _get_bg(widget, default="#e2e6e9"):
    try:
        return widget.cget("bg")
    except Exception:
        return default


def build_search_bar(parent, search_var, on_search, width=None):
    """Create a styled search bar (Entry + Button) and pack it to the right.

    Returns (entry, frame) for further customization.
    """
    if width is None:
        width = config.WIDGET_WIDTHS['search_entry']
    bg = _get_bg(parent)
    frame = tk.Frame(parent, bg=bg)
    frame.pack(side=tk.RIGHT, padx=config.PADDING_H['medium'])
    entry = tk.Entry(frame, textvariable=search_var, font=FONTS["small"], width=width)
    entry.pack(side=tk.LEFT, padx=(0, 6), pady=18)
    entry.bind("<Return>", lambda e: on_search())
    # Use shared action button with charcoal role to differentiate from blue actions
    btn = make_action_button(frame, "Search", on_search, role="charcoal", font=FONTS["button"])  # auto-size
    btn.pack(side=tk.LEFT)
    return entry, frame


def create_kv_row(parent, label_text, value_text, lbl_style, val_style, bg=None):
    """Create a label:value row using provided styles and return the row frame."""
    row = tk.Frame(parent, bg=bg or lbl_style.get("bg"))
    row.pack(anchor="w", fill="x", pady=1)
    tk.Label(row, text=f"{label_text}:", **lbl_style).pack(side=tk.LEFT)
    tk.Label(row, text=value_text, **val_style).pack(side=tk.LEFT, padx=(4, 0))
    return row


def add_separator(parent, color=None, pady=None):
    """Add a thin horizontal separator line with consistent styling."""
    if color is None:
        color = config.SEPARATOR_COLOR
    if pady is None:
        pady = config.PADDING['default']
    sep = tk.Frame(parent, height=1, bg=color)
    sep.pack(fill=tk.X, pady=pady)
    return sep


def build_uniform_row(parent, person, bg="#e2e6e9"):
    """Render the compact uniform info row in a consistent style."""
    row = tk.Frame(parent, bg=bg, padx=5, pady=2)
    row.pack(fill=tk.X, pady=(10, 0))
    tk.Label(row, text="Uniform:", font=FONTS["tiny_bold"], bg=bg).pack(side=tk.LEFT)
    u_txt = f"S:{person.get('Shirt Size','-')} P:{person.get('Pants Size','-')} B:{person.get('Boots Size','-')}"
    tk.Label(row, text=u_txt, font=FONTS["tiny"], bg=bg).pack(side=tk.LEFT, padx=5)
    issued = bool(person.get("Uniform Issued"))
    status = config.UNIFORM_STATUS_ISSUED if issued else config.UNIFORM_STATUS_NOT_ISSUED
    u_fg = config.UNIFORM_STATUS_ISSUED_COLOR if issued else config.UNIFORM_STATUS_NOT_ISSUED_COLOR
    tk.Label(row, text=status, font=FONTS["tiny_bold"], bg=bg, fg=u_fg).pack(side=tk.RIGHT)
    return row


def build_info_bar(parent, person, fields, lbl_style, val_style):
    """Render a horizontal info bar of inline label/value pairs."""
    info_bar = tk.Frame(parent, bg=lbl_style.get("bg"))
    info_bar.pack(fill=tk.X, padx=4, pady=config.PADDING['info_bar'])
    for label, key in fields:
        tk.Label(info_bar, text=f"{label}", **lbl_style).pack(side=tk.LEFT)
        tk.Label(info_bar, text=person.get(key, "N/A"), **val_style).pack(side=tk.LEFT, padx=(3, 12))
    return info_bar


def build_section_header(parent, text, style):
    """Create a section header label using provided style and return it."""
    return tk.Label(parent, text=text, **style)


def build_neo_badge(parent, neo_date):
    """Create a NEO status badge label based on the scheduled date."""
    neo_disp = "Not Scheduled"
    neo_bg, neo_fg = config.NEO_BADGE_COLORS['default']
    
    date_str = (neo_date or '').strip()
    if date_str:
        neo_disp = f"NEO: {date_str}"
        today_str = datetime.now().strftime("%m/%d/%Y")
        try:
            if date_str == today_str:
                neo_bg, neo_fg = config.NEO_BADGE_COLORS['today']
            else:
                neo_bg, neo_fg = config.NEO_BADGE_COLORS['future']
        except Exception:
            pass
    return tk.Label(parent, text=neo_disp, bg=neo_bg, fg=neo_fg, font=FONTS["tiny_bold"], padx=config.PADDING_H['medium'], pady=config.PADDING['badge'][0])

# --- Theme helpers (centralized) ---
def pick_initial_theme():
    """Return 'dark' or 'light' based on optional darkdetect."""
    try:
        import importlib
        darkdetect = importlib.import_module('darkdetect')
        if hasattr(darkdetect, 'isDark') and callable(darkdetect.isDark):
            return 'dark' if darkdetect.isDark() else 'light'
    except Exception:
        pass
    return 'light'

def detect_theme_engine():
    """Detect available ttk theme engine.
    Returns (engine, tb_style) where engine in {'sv_ttk','ttkbootstrap',None}.
    """
    try:
        import importlib
        importlib.import_module('sv_ttk')
        return 'sv_ttk', None
    except Exception:
        pass
    try:
        import importlib
        tb = importlib.import_module('ttkbootstrap')
        try:
            style = tb.Style()
        except Exception:
            style = None
        return 'ttkbootstrap', style
    except Exception:
        pass
    return None, None

def set_engine_theme(root, engine, theme, tb_style=None):
    """Apply ttk engine theme. Returns updated tb_style if applicable."""
    try:
        if engine == 'sv_ttk':
            import importlib
            sv_ttk = importlib.import_module('sv_ttk')
            sv_ttk.set_theme(theme)
            return None
        elif engine == 'ttkbootstrap':
            import importlib
            tb = importlib.import_module('ttkbootstrap')
            style = tb_style or tb.Style()
            theme_name = 'darkly' if theme == 'dark' else 'flatly'
            try:
                style.theme_use(theme_name)
            except Exception:
                # Fallback to creating fresh style
                style = tb.Style(theme_name)
            return style
        else:
            # Generic ttk fallback
            try:
                desired = 'clam' if theme == 'dark' else 'default'
                root.tk.call('ttk::style', 'theme', 'use', desired)
            except Exception:
                pass
            return None
    except Exception:
        return tb_style

def get_palette(theme):
    """Return a color palette dict for the given theme ('light' or 'dark')."""
    if theme == 'dark':
        return {
            "bg_color": "#121212",
            "fg_color": "#ecf0f1",
            "accent_color": "#4ea0ff",
            "ribbon_color": "#8F00FF",
            "button_color": "#2ecc71",
            "error_color": "#e74c3c",
            "warning_color": "#f39c12",
            "card_bg_color": "#2c2f33",
            "checkbox_select_color": "#ffffff",
        }
    return {
        "bg_color": "#e2e6e9",
        "fg_color": "#2c3e50",
        "accent_color": "#3498db",
        "ribbon_color": "#3498db",
        "button_color": "#27ae60",
        "error_color": "#e74c3c",
        "warning_color": "#f39c12",
        "card_bg_color": "#ffffff",
        "checkbox_select_color": "#000000",
    }

def apply_palette(root, palette, refs):
    """Apply palette across common frames.

    refs: dict with optional keys:
      title_frame, title_label, search_container, filters_container,
      filters_frame, container, scrollable_frame, canvas
    """
    try:
        root.configure(bg=palette.get("bg_color"))
    except Exception:
        pass
    # Keep global palette in sync for downstream style functions
    try:
        if isinstance(palette, dict):
            CURRENT_PALETTE.update(palette)
    except Exception:
        pass
    def _safe_conf(w, **opts):
        try:
            if w is not None:
                w.configure(**opts)
        except Exception:
            pass
    # Title uses ribbon color if provided; otherwise accent
    ribbon = palette.get("ribbon_color", palette.get("accent_color"))
    _safe_conf(refs.get('title_frame'), bg=ribbon)
    _safe_conf(refs.get('title_label'), bg=ribbon, fg="white")
    _safe_conf(refs.get('search_container'), bg=ribbon)
    _safe_conf(refs.get('title_stack'), bg=ribbon)
    # Others use bg
    for k in ('filters_container', 'filters_frame', 'container', 'scrollable_frame', 'dashboard_frame', 'left_col', 'right_col'):
        _safe_conf(refs.get(k), bg=palette.get("bg_color"))
    _safe_conf(refs.get('canvas'), bg=palette.get("bg_color"))
    # No return value
    return None

def load_stylesheet(path):
    """Load a JSON stylesheet and update global font and role tokens.

    Returns the palette dict from the stylesheet (or None if missing).
    """
    try:
        import json, os
        if not os.path.exists(path):
            return None
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        fonts = data.get('fonts', {})
        roles = data.get('roles', {})
        palette = data.get('palette', None)
        # Update FONTS tokens
        for k, v in fonts.items():
            try:
                # Expect [family, size, weight?]
                if isinstance(v, (list, tuple)) and len(v) >= 2:
                    FONTS[k] = tuple(v)
            except Exception:
                pass
        # Update role colors
        for role, pair in roles.items():
            try:
                if isinstance(pair, (list, tuple)) and len(pair) >= 2:
                    _ROLE_COLORS[role] = (pair[0], pair[1])
            except Exception:
                pass
        return palette
    except Exception:
        return None

def apply_stylesheet(root, path, refs):
    """Load stylesheet JSON and apply its palette across UI."""
    palette = load_stylesheet(path)
    if palette:
        apply_palette(root, palette, refs)
    return palette

def reset_stylesheet(root, refs, theme='light'):
    """Restore default tokens and apply base palette for given theme."""
    try:
        # Reset tokens
        for k, v in DEFAULT_FONTS.items():
            FONTS[k] = v
        for role, pair in DEFAULT_ROLE_COLORS.items():
            _ROLE_COLORS[role] = pair
    except Exception:
        pass
    palette = get_palette(theme)
    apply_palette(root, palette, refs)
    return palette

def _hex_to_rgb(h):
    try:
        h = (h or '').strip().lstrip('#')
        if len(h) == 6:
            return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))
    except Exception:
        pass
    return (255, 255, 255)

def _is_dark_color(h):
    r, g, b = _hex_to_rgb(h)
    lum = (0.299*r + 0.587*g + 0.114*b) / 255.0
    return lum < 0.5

def apply_chrome_tokens(refs):
    """Update fonts and role colors for chrome (title bar + filters)."""
    try:
        lbl = refs.get('title_label')
        if lbl is not None:
            lbl.config(font=FONTS['title'])
    except Exception:
        pass
    # Update buttons in title frame
    try:
        tf = refs.get('title_frame')
        if tf is not None:
            for child in tf.winfo_children():
                try:
                    if isinstance(child, tk.Button):
                        role = BUTTON_ROLE_REGISTRY.get(child, 'default')
                        bg, active = _ROLE_COLORS.get(role, _ROLE_COLORS['default'])
                        fg = 'black' if role in ALWAYS_BLACK_TEXT_ROLES else ('white' if _is_dark_color(bg) else 'black')
                        child.config(
                            bg=bg,
                            activebackground=active,
                            fg=fg,
                            activeforeground=fg,
                            font=FONTS['button'],
                            relief=tk.SOLID,
                            bd=1,
                            highlightthickness=1,
                            highlightbackground=BUTTON_OUTLINE_COLOR,
                            highlightcolor=BUTTON_OUTLINE_COLOR
                        )
                except Exception:
                    pass
    except Exception:
        pass
    # Update buttons in the right-side title stack as well
    try:
        ts = refs.get('title_stack')
        if ts is not None:
            for child in ts.winfo_children():
                try:
                    if isinstance(child, tk.Button):
                        role = BUTTON_ROLE_REGISTRY.get(child, 'default')
                        bg, active = _ROLE_COLORS.get(role, _ROLE_COLORS['default'])
                        fg = 'black' if role in ALWAYS_BLACK_TEXT_ROLES else ('white' if _is_dark_color(bg) else 'black')
                        child.config(
                            bg=bg,
                            activebackground=active,
                            fg=fg,
                            activeforeground=fg,
                            font=FONTS['button'],
                            relief=tk.SOLID,
                            bd=1,
                            highlightthickness=1,
                            highlightbackground=BUTTON_OUTLINE_COLOR,
                            highlightcolor=BUTTON_OUTLINE_COLOR
                        )
                except Exception:
                    pass
    except Exception:
        pass
    # Filters labels and checkbuttons
    try:
        ff = refs.get('filters_frame')
        if ff is not None:
            for child in ff.winfo_children():
                try:
                    if isinstance(child, tk.Label) or isinstance(child, tk.Checkbutton) or isinstance(child, tk.Radiobutton):
                        # Use stylesheet-driven fg from CURRENT_PALETTE
                        try:
                            parent_bg = ff.cget('bg')
                        except Exception:
                            parent_bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
                        fg = CURRENT_PALETTE.get('fg_color', '#2c3e50')
                        try:
                            child.config(bg=parent_bg, fg=fg, font=FONTS['small'])
                        except Exception:
                            child.config(bg=parent_bg, font=FONTS['small'])
                    # Style ttk Combobox to match filters frame background and dropdown list
                    if isinstance(child, ttk.Combobox):
                        try:
                            parent_bg = ff.cget('bg')
                        except Exception:
                            parent_bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
                        try:
                            is_dark = _is_dark_color(parent_bg)
                            fg = CURRENT_PALETTE.get('fg_color', '#2c3e50')
                            select_bg = '#4ea0ff' if is_dark else '#cde6ff'
                            select_fg = 'white' if is_dark else 'black'
                            style = ttk.Style()
                            # Field and arrow colors to blend with filters frame
                            style.configure(
                                'Filters.TCombobox',
                                fieldbackground=parent_bg,
                                background=parent_bg,
                                foreground=fg,
                                arrowcolor=fg,
                                font=FONTS['small'],
                                bordercolor=parent_bg,
                                lightcolor=parent_bg,
                                darkcolor=parent_bg
                            )
                            style.map(
                                'Filters.TCombobox',
                                foreground=[('disabled', '#888888'), ('!disabled', fg)],
                                fieldbackground=[('readonly', parent_bg), ('!readonly', parent_bg)]
                            )
                            child.configure(style='Filters.TCombobox')
                            # Popdown listbox colors for better dark/light readability
                            try:
                                root = ff.winfo_toplevel()
                                root.option_add('*TCombobox*Listbox.background', parent_bg)
                                root.option_add('*TCombobox*Listbox.foreground', fg)
                                root.option_add('*TCombobox*Listbox.selectBackground', select_bg)
                                root.option_add('*TCombobox*Listbox.selectForeground', select_fg)
                            except Exception:
                                pass
                        except Exception:
                            pass
                    if isinstance(child, tk.Button):
                        role = BUTTON_ROLE_REGISTRY.get(child, 'default')
                        bg, active = _ROLE_COLORS.get(role, _ROLE_COLORS['default'])
                        fg = 'black' if role in ALWAYS_BLACK_TEXT_ROLES else ('white' if _is_dark_color(bg) else 'black')
                        child.config(
                            bg=bg,
                            activebackground=active,
                            fg=fg,
                            activeforeground=fg,
                            font=FONTS['button'],
                            relief=tk.SOLID,
                            bd=1,
                            highlightthickness=1,
                            highlightbackground=BUTTON_OUTLINE_COLOR,
                            highlightcolor=BUTTON_OUTLINE_COLOR
                        )
                except Exception:
                    pass
    except Exception:
        pass

    # Search bar fonts and button restyling
    try:
        sc = refs.get('search_container')
        if sc is not None:
            for child in sc.winfo_children():
                try:
                    if isinstance(child, tk.Entry):
                        child.config(font=FONTS['small'])
                    elif isinstance(child, tk.Button):
                        role = BUTTON_ROLE_REGISTRY.get(child, 'default')
                        bg, active = _ROLE_COLORS.get(role, _ROLE_COLORS['default'])
                        fg = 'black' if role in ALWAYS_BLACK_TEXT_ROLES else ('white' if _is_dark_color(bg) else 'black')
                        child.config(
                            bg=bg,
                            activebackground=active,
                            fg=fg,
                            activeforeground=fg,
                            font=FONTS['button'],
                            relief=tk.SOLID,
                            bd=1,
                            highlightthickness=1,
                            highlightbackground=BUTTON_OUTLINE_COLOR,
                            highlightcolor=BUTTON_OUTLINE_COLOR
                        )
                except Exception:
                    pass
    except Exception:
        pass

def apply_text_contrast(container):
    """Recursively apply readable foreground colors to labels/check/radio within a container.

    Uses the container's background to choose a contrasting text color.
    """
    try:
        try:
            bg = container.cget('bg')
        except Exception:
            bg = '#e2e6e9'
        is_dark = _is_dark_color(bg)
        fg = '#ecf0f1' if is_dark else '#2c3e50'
        # Choose a visible indicator fill for check/radio selection (theme-driven)
        select_fill = CURRENT_PALETTE.get('checkbox_select_color', '#ffffff' if is_dark else '#000000')
        for child in container.winfo_children():
            try:
                if isinstance(child, (tk.Label, tk.Checkbutton, tk.Radiobutton)):
                    try:
                        child.config(fg=fg)
                        if isinstance(child, tk.Radiobutton) or isinstance(child, tk.Checkbutton):
                            child.config(activeforeground=fg)
                            # Ensure the selected indicator background is visible
                            try:
                                child.config(selectcolor=select_fill)
                            except Exception:
                                pass
                            # Match activebackground to container bg to avoid flashing
                            try:
                                child.config(activebackground=bg)
                            except Exception:
                                pass
                    except Exception:
                        pass
                # Recurse into nested frames
                if isinstance(child, (tk.Frame, tk.LabelFrame)):
                    apply_text_contrast(child)
            except Exception:
                pass
    except Exception:
        pass

def apply_button_roles(container):
    """Recursively restyle tk.Buttons based on registered roles.

    Ensures buttons use role background/active colors and readable text.
    """
    try:
        for child in container.winfo_children():
            try:
                if isinstance(child, tk.Button):
                    role = BUTTON_ROLE_REGISTRY.get(child, 'default')
                    bg, active = _ROLE_COLORS.get(role, _ROLE_COLORS['default'])
                    fg = 'black' if role in ALWAYS_BLACK_TEXT_ROLES else ('white' if _is_dark_color(bg) else 'black')
                    child.config(
                        bg=bg,
                        fg=fg,
                        activebackground=active,
                        activeforeground=fg,
                        relief=tk.SOLID,
                        bd=1,
                        highlightthickness=1,
                        highlightbackground=BUTTON_OUTLINE_COLOR,
                        highlightcolor=BUTTON_OUTLINE_COLOR
                    )
                if isinstance(child, (tk.Frame, tk.LabelFrame)):
                    apply_button_roles(child)
            except Exception:
                pass
    except Exception:
        pass

def fix_checkbox_contrast(container, use_bg=None):
    """Ensure Checkbutton/Radiobutton have a visible selected indicator color.

    If the background is light, use black; if dark, use white.
    Recurses through child frames.
    """
    try:
        try:
            bg = use_bg if use_bg is not None else container.cget('bg')
        except Exception:
            bg = CURRENT_PALETTE.get('bg_color', '#e2e6e9')
        sel = CURRENT_PALETTE.get('checkbox_select_color', '#ffffff' if _is_dark_color(bg) else '#000000')
        for child in container.winfo_children():
            try:
                if isinstance(child, (tk.Checkbutton, tk.Radiobutton)):
                    try:
                        child.config(selectcolor=sel)
                        child.config(activebackground=bg)
                    except Exception:
                        pass
                if isinstance(child, (tk.Frame, tk.LabelFrame)):
                    fix_checkbox_contrast(child, use_bg=bg)
            except Exception:
                pass
    except Exception:
        pass
