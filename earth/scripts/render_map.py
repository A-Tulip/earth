import shapefile
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon

sf = shapefile.Reader("natural-earth/ne_10m_admin_0_countries.shp")

fig, ax = plt.subplots(figsize=(20, 10), dpi=102.4)
fig.patch.set_facecolor('#2c5282')
ax.set_facecolor('#2c5282')
ax.set_xlim([-180, 180])
ax.set_ylim([-90, 90])
ax.set_aspect('equal')
ax.set_axis_off()

colors = [
    '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
    '#1abc9c', '#e91e63', '#607d8b', '#ff9800', '#00bcd4',
    '#4caf50', '#ff5722', '#795548', '#673ab7', '#009688',
    '#f44336', '#2196f3', '#43a047', '#fb8c00', '#3f51b5',
    '#00acc1', '#c62828', '#1565c0', '#2e7d32', '#ef6c00',
    '#5e35b1', '#00838f', '#d32f2f', '#0d47a1', '#1b5e20',
    '#e65100', '#4527a0', '#006064', '#b71c1c', '#01579b',
    '#33691e', '#bf360c', '#311b92', '#004d40', '#880e4f',
    '#1565c0', '#4caf50', '#ff9800', '#9c27b0', '#00bcd4',
    '#ff5722', '#607d8b', '#e91e63', '#1abc9c', '#f39c12',
    '#9b59b6', '#2ecc71', '#3498db', '#e74c3c', '#27ae60'
]

color_idx = 0
for shape in sf.shapes():
    color = colors[color_idx % len(colors)]
    color_idx += 1
    for part_idx, part in enumerate(shape.parts):
        if part_idx < len(shape.parts) - 1:
            points = shape.points[part:shape.parts[part_idx + 1]]
        else:
            points = shape.points[part:]
        if len(points) >= 3:
            poly = Polygon(points, closed=True, facecolor=color, edgecolor='#2c3e50', linewidth=0.3)
            ax.add_patch(poly)

plt.savefig('images/world-political.png', dpi=102.4, bbox_inches='tight', pad_inches=0, facecolor=fig.get_facecolor())
print('Map rendered successfully - NO TEXT')
