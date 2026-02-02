#!/usr/bin/env python3
"""
Weekly Tracker GUI
Track your work accomplishments from Friday to Thursday
"""

import tkinter as tk
from tkinter import scrolledtext, messagebox
import os
import json
from datetime import datetime, timedelta

# ============================================================================
# CONSTANTS
# ============================================================================
FONTS = {
    "title": ("Verdana", 20, "bold"),
    "header": ("Verdana", 18, "bold"),
    "subheader": ("Verdana", 14, "bold"),
    "button": ("Verdana", 11, "bold"),
    "body": ("Verdana", 11),
    "small": ("Verdana", 10),
    "tiny": ("Verdana", 9),
    "subtext_bold": ("Verdana", 12, "bold"),
}

WEEKDAY_NAMES = [
    "Friday",
    "Saturday",
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
]

LIGHT_PALETTE = {
    "bg_color": "#e2e6e9",
    "fg_color": "#2c3e50",
    "accent_color": "#3498db",
    "button_color": "#27ae60",
    "error_color": "#e74c3c",
    "warning_color": "#f39c12",
    "card_bg_color": "#ffffff",
}

BUTTON_ROLE_COLORS = {
    "save": ("#27ae60", "#229954"),
    "cancel": ("#e74c3c", "#c0392b"),
    "default": ("#3498db", "#2e86c1"),
}

NO_ENTRIES_TEXT = "(No entries for this day)"
NO_ACTIVITIES_TEXT = "(No activities entered)"
TRACKER_EXPORTS_DIR = "exports"

def make_action_button(parent, text, command, role="default", font=None, width=None):
    """Create a styled action button."""
    bg, active = BUTTON_ROLE_COLORS.get(role, BUTTON_ROLE_COLORS["default"])
    if font is None:
        font = FONTS["button"]
    btn = tk.Button(
        parent, text=text, command=command, bg=bg, fg="white",
        activebackground=active, activeforeground="white", font=font,
        relief=tk.SOLID, bd=1, cursor="hand2"
    )
    if width is not None:
        btn.config(width=width)
    return btn

def show_error(parent, title, message):
    messagebox.showerror(title, message, parent=parent)

def show_info(parent, title, message):
    messagebox.showinfo(title, message, parent=parent)

def show_warning(parent, title, message):
    messagebox.showwarning(title, message, parent=parent)

def ask_yes_no(parent, title, message):
    return messagebox.askyesno(title, message, parent=parent)


class WeeklyTrackerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Weekly Work Tracker")
        self.root.geometry("1400x1000")
        self.root.resizable(True, True)
        
        # Set color scheme
        palette = LIGHT_PALETTE
        self.bg_color = palette["bg_color"]
        self.fg_color = palette["fg_color"]
        self.accent_color = palette["accent_color"]
        self.button_color = palette["button_color"]
        self.error_color = palette["error_color"]
        self.warning_color = palette["warning_color"]
        self.card_bg_color = palette["card_bg_color"]
        self.fonts = FONTS
        
        self.root.configure(bg=self.bg_color)

        # Expose helpers
        self.show_error = show_error
        self.show_info = show_info
        self.show_warning = show_warning
        self.ask_yes_no = ask_yes_no
        
        # Setup variables
        self.tracker_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
        os.makedirs(self.tracker_dir, exist_ok=True)
        
        # Get current work week dates
        self.week_start, self.week_end = self.get_current_work_week()
        self.week_file = self.get_week_filename()
        
        # Day text widgets storage
        self.day_widgets = {}
        self.days = WEEKDAY_NAMES

        self.create_widgets()
        self.load_week_data()
        self._setup_keyboard_shortcuts()
    
    def _setup_keyboard_shortcuts(self) -> None:
        """Setup keyboard shortcuts for common operations."""
        try:
            self.root.bind("<Control-s>", lambda e: self.save_week())
            self.root.bind("<Control-e>", lambda e: self.export_summary())
            self.root.bind("<Control-k>", lambda e: self.clear_week())
        except RuntimeError:
            pass
    
    def get_current_work_week(self):
        """
        Calculate the current work week (Friday to Thursday)
        Returns: (week_start_date, week_end_date)
        """
        today = datetime.now().date()
        
        # Find the Friday that started this work week
        # Weekday: Monday=0, Tuesday=1, ..., Friday=4, Saturday=5, Sunday=6
        weekday = today.weekday()
        
        if weekday >= 4:  # Friday (4), Saturday (5), Sunday (6)
            # We're in the Friday-Sunday part, so find last Friday
            days_since_friday = weekday - 4
            week_start = today - timedelta(days=days_since_friday)
        else:  # Monday (0), Tuesday (1), Wednesday (2), Thursday (3)
            # We're in the Monday-Thursday part, so find the Friday before
            days_since_friday = weekday + 3  # 3, 4, 5, 6 days ago
            week_start = today - timedelta(days=days_since_friday)
        
        week_end = week_start + timedelta(days=6)  # Thursday
        
        return week_start, week_end
    
    def get_week_filename(self):
        """Generate filename for the current work week"""
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
        title_frame = tk.Frame(self.root, bg=self.accent_color, height=60)
        title_frame.pack(fill=tk.X, pady=(0, 10))
        title_frame.pack_propagate(False)
        title_label = tk.Label(
            title_frame,
            text="📅 Weekly Work Tracker",
            font=FONTS["title"],
            bg=self.accent_color,
            fg="white"
        )
        title_label.pack(expand=True)

    def _build_week_info(self) -> None:
        week_info_frame = tk.Frame(self.root, bg=self.bg_color)
        week_info_frame.pack(fill=tk.X, padx=20, pady=(0, 10))
        week_label = tk.Label(
            week_info_frame,
            text=f"Work Week: {self.week_start.strftime('%B %d, %Y')} - {self.week_end.strftime('%B %d, %Y')}",
            font=FONTS["subheader"],
            bg=self.bg_color,
            fg="#1a3a5a"
        )
        week_label.pack()

    def _build_content_area(self) -> None:
        container = tk.Frame(self.root, bg=self.bg_color)
        container.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        self.content_frame = tk.Frame(container, bg=self.bg_color)
        self.content_frame.pack(fill=tk.BOTH, expand=True)
        self.create_day_sections()

    def _build_buttons(self) -> None:
        button_frame = tk.Frame(self.root, bg=self.bg_color)
        button_frame.pack(fill=tk.X, padx=20, pady=20)
        save_btn = make_action_button(button_frame, "Save Week", self.save_week, role="save", font=FONTS["button"], width=16)
        save_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(0, 5))
        export_btn = make_action_button(button_frame, "📤 Export Summary", self.export_summary, role="view", font=FONTS["button"], width=18)
        export_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(5, 5))
        clear_btn = make_action_button(button_frame, "🗑️ Clear Week", self.clear_week, role="delete", font=FONTS["button"], width=16)
        clear_btn.pack(side=tk.LEFT, expand=True, fill=tk.X, padx=(5, 0))
    
    
    def create_day_sections(self):
        """Create a section for each day of the work week"""
        days = self.days
        self.content_frame.columnconfigure(0, weight=1)
        self.content_frame.columnconfigure(1, weight=1)

        for i, day_name in enumerate(days):
            row = i // 2
            col = i % 2
            is_last_day = (i == len(days) - 1)
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
                anchor="w"
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
                pady=10
            )
            text_widget.pack(fill=tk.BOTH, expand=True)

            self.day_widgets[day_name] = {
                'widget': text_widget,
                'start_entry': start_entry,
                'end_entry': end_entry,
                'date': day_date,
                'date_str': date_str
            }
    
    def load_week_data(self):
        """Load existing week data if file exists"""
        if os.path.exists(self.week_file):
            try:
                with open(self.week_file, 'r', encoding='utf-8') as f:
                    data = json.load(f)

                # Support legacy format (day_name -> content) and new format with entries
                entries = data.get('entries') if isinstance(data, dict) else None
                if not entries and isinstance(data, dict):
                    entries = data

                # Populate day sections
                for day_name, content_data in (entries or {}).items():
                    if day_name in self.day_widgets:
                        day_info = self.day_widgets[day_name]
                        
                        # Handle both legacy format (string) and new format (dict)
                        if isinstance(content_data, dict):
                            content = content_data.get('content', '')
                            start = content_data.get('start', '')
                            end = content_data.get('end', '')
                        else:
                            content = content_data
                            start = ""
                            end = ""
                            
                        day_info['widget'].delete("1.0", tk.END)
                        if content != NO_ENTRIES_TEXT:
                            day_info['widget'].insert('1.0', content)
                        
                        day_info['start_entry'].delete(0, tk.END)
                        day_info['start_entry'].insert(0, start)
                        
                        day_info['end_entry'].delete(0, tk.END)
                        day_info['end_entry'].insert(0, end)
                
            except (OSError, json.JSONDecodeError) as e:
                self.show_error(self.root, "Load Error", f"Could not load week data:\n{str(e)}")
    
    
    def save_week(self):
        """Save the current week data to file"""
        try:
            data = self.generate_week_data()

            with open(self.week_file, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4, ensure_ascii=False)
            
            self.show_info(self.root, "Saved!", f"Week tracker saved to:\n{self.week_file}")
            
        except OSError as e:
            self.show_error(self.root, "Save Error", f"Could not save week data:\n{str(e)}")
    
    def generate_week_data(self):
        """Generate the entries mapping for the week.
        Returns a dict keyed by weekday with 'content', 'start', 'end'.
        """
        data = {
            "metadata": {
                "week_start": self.week_start.strftime("%Y-%m-%d"),
                "week_end": self.week_end.strftime("%Y-%m-%d"),
                "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            },
            "entries": {}
        }
        
        for day_name in self.days:
            day_info = self.day_widgets[day_name]
            day_content = day_info['widget'].get("1.0", tk.END).strip()
            day_start = day_info['start_entry'].get().strip()
            day_end = day_info['end_entry'].get().strip()
            
            data["entries"][day_name] = {
                "content": day_content if day_content else NO_ENTRIES_TEXT,
                "start": day_start,
                "end": day_end
            }
        
        return data

    def _parse_time_to_minutes(self, time_str: str):
        """Parse time strings like 8, 800, 08:00, 1730 into minutes from midnight."""
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
        """Calculate hours between two times and round to nearest 30 mins (0.5)"""
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
        """Export a summary of the week to a raw .txt file for easy copy-pasting"""
        try:
            data = self.generate_week_data()
            entries = data.get("entries", {})
            total_week_hours = 0.0
            
            lines = []
            lines.append("=" * 60)
            lines.append(f"WEEKLY WORK TRACKER SUMMARY")
            lines.append(f"Work Week: {self.week_start.strftime('%B %d, %Y')} - {self.week_end.strftime('%B %d, %Y')}")
            lines.append(f"Generated: {datetime.now().strftime('%B %d, %Y at %I:%M %p')}")
            lines.append("=" * 60)
            lines.append("")
            
            day_details = []
            for day_name in self.days:
                day_data = entries.get(day_name, {})
                content = day_data.get('content', '')
                start = day_data.get('start', '')
                end = day_data.get('end', '')
                
                day_hours = self.calculate_day_hours(start, end)
                total_week_hours += day_hours
                
                day_details.append(f"--- {day_name} ---")
                if start and end:
                    day_details.append(f"Time: {start} to {end} ({day_hours} hours)")
                else:
                    day_details.append(f"Time: (Not specified)")
                
                day_details.append(f"Activities:")
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
            
            # Save to tracker exports folder
            exports_dir = os.path.join(self.tracker_dir, TRACKER_EXPORTS_DIR)
            os.makedirs(exports_dir, exist_ok=True)

            filename = os.path.basename(self.week_file).replace('.json', '_SUMMARY.txt')
            summary_file = os.path.join(exports_dir, filename)

            with open(summary_file, 'w', encoding='utf-8') as f:
                f.write(content_str)
            
            self.show_info(self.root, "Exported!", f"Summary exported to:\n{summary_file}")
            
        except OSError as e:
            self.show_error(self.root, "Export Error", f"Could not export summary:\n{str(e)}")
    
    def clear_week(self):
        """Clear all entries for the week"""
        result = self.ask_yes_no(self.root, "Clear Week?", "Are you sure you want to clear all entries for this week?\n\nThis cannot be undone!")
        
        if result:
            for day_info in self.day_widgets.values():
                day_info['widget'].delete("1.0", tk.END)
            
            self.show_info(self.root, "Cleared", "All entries have been cleared.")

def main():
    root = tk.Tk()
    app = WeeklyTrackerGUI(root)
    root.mainloop()

if __name__ == "__main__":
    main()
