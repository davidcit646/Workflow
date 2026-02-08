#!/usr/bin/env python3
"""
Create a simple icon for the tray
"""

try:
    from PIL import Image, ImageDraw
    import os
    
    # Create a simple 32x32 icon
    size = 32
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Draw a simple "W" for Workflow
    draw.rectangle([4, 4, 28, 28], fill=(102, 126, 234, 255))  # Blue background
    draw.text((8, 8), "W", fill=(255, 255, 255, 255))  # White W
    
    # Save to assets directory
    assets_dir = os.path.join(os.path.dirname(__file__), 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    
    icon_path = os.path.join(assets_dir, 'icon.png')
    img.save(icon_path, 'PNG')
    print(f"Created icon: {icon_path}")
    
except ImportError:
    print("PIL not available, creating simple placeholder...")
    
    # Create a simple text-based icon using ASCII art
    import os
    
    assets_dir = os.path.join(os.path.dirname(__file__), 'assets')
    os.makedirs(assets_dir, exist_ok=True)
    
    # Create a simple 1x1 pixel transparent PNG (minimal valid PNG)
    icon_data = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc`\x00\x00\x00\x02\x00\x01\xe2!\xbc\x33\x00\x00\x00\x00IEND\xaeB`\x82'
    
    icon_path = os.path.join(assets_dir, 'icon.png')
    with open(icon_path, 'wb') as f:
        f.write(icon_data)
    
    print(f"Created minimal icon: {icon_path}")
