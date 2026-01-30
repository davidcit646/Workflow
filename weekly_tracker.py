#!/usr/bin/env python3
"""
Weekly Tracker GUI
Track your work accomplishments from Friday to Thursday
"""

import tkinter as tk
from tkinter import scrolledtext
from ui_helpers import (
    FONTS,
    make_action_button,
    show_error,
    show_info,
    show_warning,
    ask_yes_no,
)
import os
import json
from datetime import datetime, timedelta

class WeeklyTrackerGUI:
    def __init__(self, root):
        self.root = root
        self.root.title("Weekly Work Tracker")
        self.root.geometry("1400x1000")
        self.root.resizable(True, True)
        
        # Set color scheme (Match workflow.py Light Theme)
        self.bg_color = "#e2e6e9"
        self.fg_color = "#2c3e50"
        self.accent_color = "#3498db"
        self.button_color = "#27ae60"
        self.error_color = "#e74c3c"
        self.warning_color = "#f39c12"
        self.card_bg_color = "#ffffff"
        
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
        # Weekday list constant for reuse
        self.days = ["Friday", "Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"]
        
        self.create_widgets()
        self.load_week_data()
        # Keyboard shortcuts
        try:
            self.root.bind_all("<Control-s>", lambda e: self.save_week())
            self.root.bind_all("<Control-e>", lambda e: self.export_summary())
            self.root.bind_all("<Control-k>", lambda e: self.clear_week())
        except Exception:
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
        # Title
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
        
        # Week info
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
        
        # Create content area for days
        container = tk.Frame(self.root, bg=self.bg_color)
        container.pack(fill=tk.BOTH, expand=True, padx=20, pady=10)
        
        self.content_frame = tk.Frame(container, bg=self.bg_color)
        self.content_frame.pack(fill=tk.BOTH, expand=True)
        
        # Create day sections
        self.create_day_sections()
        
        # Buttons
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
        
        # Configure grid columns
        self.content_frame.columnconfigure(0, weight=1)
        self.content_frame.columnconfigure(1, weight=1)
        
        for i, day_name in enumerate(days):
            # Calculate row and column (2-column layout)
            row = i // 2
            col = i % 2
            
            # Thursday (index 6) spans both columns
            is_last_day = (i == len(days) - 1)

            # Calculate the date for this day
            day_date = self.week_start + timedelta(days=i)
            date_str = day_date.strftime("%B %d, %Y")
            
            # Check if this day has passed
            today = datetime.now().date()
            is_past = day_date <= today
            is_today = day_date == today
            
            # Create section frame
            section_frame = tk.Frame(self.content_frame, bg=self.bg_color)
            if is_last_day:
                section_frame.grid(row=row, column=0, columnspan=2, sticky="nsew", padx=10, pady=5)
            else:
                section_frame.grid(row=row, column=col, sticky="nsew", padx=10, pady=5)
            
            # Header with day and date
            header_frame = tk.Frame(section_frame, bg=self.bg_color)
            header_frame.pack(fill=tk.X, pady=(0, 5))
            
            # Day indicator color
            if is_today:
                indicator_color = self.button_color  # Green for today
                day_label_text = f"📍 {day_name} - {date_str} (TODAY)"
            elif is_past:
                indicator_color = self.accent_color  # Blue for past days
                day_label_text = f"{day_name} - {date_str}"
            else:
                indicator_color = "#7f8c8d"  # Gray for future days
                day_label_text = f"{day_name} - {date_str} (upcoming)"
            
            day_label = tk.Label(
                header_frame,
                text=day_label_text,
                font=FONTS["subtext_bold"],
                bg=self.bg_color,
                fg=indicator_color if not is_today else "#1a3a5a",
                anchor="w"
            )
            day_label.pack(side=tk.LEFT)
            
            # Time entry area
            time_frame = tk.Frame(header_frame, bg=self.bg_color)
            time_frame.pack(side=tk.RIGHT)
            
            tk.Label(time_frame, text="Start:", bg=self.bg_color, fg="#1a3a5a", font=FONTS["tiny"]).pack(side=tk.LEFT)
            start_entry = tk.Entry(time_frame, width=8, font=FONTS["tiny"], relief=tk.FLAT)
            start_entry.pack(side=tk.LEFT, padx=(2, 10))

            tk.Label(time_frame, text="End:", bg=self.bg_color, fg="#1a3a5a", font=FONTS["tiny"]).pack(side=tk.LEFT)
            end_entry = tk.Entry(time_frame, width=8, font=FONTS["tiny"], relief=tk.FLAT)
            end_entry.pack(side=tk.LEFT, padx=(2, 0))
            
            # Separator
            separator = tk.Frame(section_frame, height=2, bg=indicator_color)
            separator.pack(fill=tk.X, pady=(0, 8))
            
            # Text area for this day
            text_widget = scrolledtext.ScrolledText(
                section_frame,
                height=5,
                font=FONTS["body"],
                bg=self.card_bg_color,
                fg="black",
                insertbackground="black",
                relief=tk.FLAT,
                wrap=tk.WORD,
                padx=15,
                pady=10
            )
            text_widget.pack(fill=tk.BOTH, expand=True)
            
            # Store widget reference
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
                with open(self.week_file, 'r') as f:
                    data = json.load(f)
                
                # Populate day sections
                for day_name, content_data in data.items():
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
                        if content != "(No entries for this day)":
                            day_info['widget'].insert('1.0', content)
                        
                        day_info['start_entry'].delete(0, tk.END)
                        day_info['start_entry'].insert(0, start)
                        
                        day_info['end_entry'].delete(0, tk.END)
                        day_info['end_entry'].insert(0, end)
                
            except Exception as e:
                self.show_error(self.root, "Load Error", f"Could not load week data:\n{str(e)}")
    
    
    def save_week(self):
        """Save the current week data to file"""
        try:
            data = self.generate_week_data()
            
            with open(self.week_file, 'w') as f:
                json.dump(data, f, indent=4)
            
            self.show_info(self.root, "Saved!", f"Week tracker saved to:\n{self.week_file}")
            
        except Exception as e:
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
                "content": day_content if day_content else "(No entries for this day)",
                "start": day_start,
                "end": day_end
            }
        
        return data["entries"]
    
    def calculate_day_hours(self, start_str, end_str):
        """Calculate hours between two times and round to nearest 30 mins (0.5)"""
        if not start_str or not end_str:
            return 0.0
            
        try:
            # Handle formats like "08:00", "0800", "8:00", "8"
            s = start_str.replace(":", "").replace(" ", "").strip()
            e = end_str.replace(":", "").replace(" ", "").strip()
            
            # Normalize to 4 digits (HHMM)
            def normalize(t):
                if len(t) == 1: return "0" + t + "00"
                if len(t) == 2: return t + "00"
                if len(t) == 3: return "0" + t
                return t
            
            s = normalize(s)
            e = normalize(e)
            
            if len(s) == 4 and len(e) == 4:
                sh = int(s[:2])
                sm = int(s[2:])
                eh = int(e[:2])
                em = int(e[2:])
                
                start_mins = sh * 60 + sm
                end_mins = eh * 60 + em
                
                diff = end_mins - start_mins
                if diff < 0: # Assume next day
                    diff += 24 * 60
                
                hours = diff / 60.0
                # Round to nearest 0.5
                return round(hours * 2) / 2
        except:
            return 0.0
        return 0.0

    def export_summary(self):
        """Export a summary of the week to a raw .txt file for easy copy-pasting"""
        try:
            entries = self.generate_week_data()
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
                if content and content != "(No entries for this day)":
                    day_details.append(content)
                else:
                    day_details.append("(No activities entered)")
                day_details.append("")
            
            lines.append(f"TOTAL WEEKLY HOURS: {total_week_hours}")
            lines.append("-" * 60)
            lines.append("")
            lines.extend(day_details)
            
            content_str = "\n".join(lines)
            
            # Save to Downloads folder
            downloads_dir = os.path.expanduser("~/Downloads")
            os.makedirs(downloads_dir, exist_ok=True)
            
            filename = os.path.basename(self.week_file).replace('.json', '_SUMMARY.txt')
            summary_file = os.path.join(downloads_dir, filename)
            
            with open(summary_file, 'w') as f:
                f.write(content_str)
            
            self.show_info(self.root, "Exported!", f"Summary exported to:\n{summary_file}")
            
        except Exception as e:
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
