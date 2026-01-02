import trimesh
import os

obj_path = "model_3d/ni1487wa0qgw-Banana_and_materials/banana.obj"
output_path = "static/models/banana.glb"

print(f"Loading banana OBJ model from: {obj_path}")

mesh = trimesh.load(obj_path, force='mesh')

mesh.visual = trimesh.visual.ColorVisuals(
    mesh=mesh,
    vertex_colors=[255, 230, 51, 255]
)

os.makedirs(os.path.dirname(output_path), exist_ok=True)

print(f"Exporting to: {output_path}")
mesh.export(output_path, file_type='glb')

print("✅ Banana conversion complete!")
print(f"File size: {os.path.getsize(output_path) / 1024:.1f} KB")
print(f"\nModel stats:")
print(f"  Vertices: {len(mesh.vertices)}")
print(f"  Faces: {len(mesh.faces)}")
