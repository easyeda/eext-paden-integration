
import math
import numpy as np
import shapely.geometry

from dataclasses import dataclass, field
from typing import Optional, Iterable, Iterator, Protocol, List, Tuple, Dict, Set


IndexType = int


class HasIndex(Protocol):
    i: IndexType


@dataclass(frozen=True)
class Vector:
    dx: float
    dy: float

    def dot(self, other: "Vector") -> float:
        return self.dx * other.dx + self.dy * other.dy

    def __add__(self, other: "Vector") -> "Vector":
        if not isinstance(other, Vector):
            raise TypeError("Addition is only defined for Vectors")
        return Vector(self.dx + other.dx, self.dy + other.dy)

    def __mul__(self, scalar: float) -> "Vector":
        return Vector(self.dx * scalar, self.dy * scalar)

    def __rmul__(self, scalar: float) -> "Vector":
        return self.__mul__(scalar)

    def __neg__(self) -> "Vector":
        return Vector(-self.dx, -self.dy)

    def __xor__(self, other: "Vector") -> float:
        return self.dx * other.dy - self.dy * other.dx

    def __abs__(self) -> float:
        return math.sqrt(self.dx ** 2 + self.dy ** 2)


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def distance(self, other: "Point") -> float:
        return math.sqrt((self.x - other.x) ** 2 + (self.y - other.y) ** 2)

    def __sub__(self, other: "Point") -> Vector:
        if not isinstance(other, Point):
            raise TypeError("Subtraction is only defined for Points")
        return Vector(self.x - other.x, self.y - other.y)

    def to_shapely(self) -> shapely.geometry.Point:
        return shapely.geometry.Point(self.x, self.y)


@dataclass(eq=False, repr=False)
class Vertex:
    p: Point
    out: Optional["HalfEdge"] = None
    i: IndexType = field(default=IndexType(0))

    def orbit(self) -> Iterator["HalfEdge"]:
        edge = self.out
        if edge is None:
            return
        while True:
            yield edge
            if edge.twin is None or edge.twin.next is None:
                break
            edge = edge.twin.next
            if edge == self.out:
                break


@dataclass(eq=False, repr=False)
class HalfEdge:
    origin: Vertex
    twin: Optional["HalfEdge"] = None
    next: Optional["HalfEdge"] = None
    prev: Optional["HalfEdge"] = None
    face: Optional["Face"] = None
    i: IndexType = field(default=IndexType(0))

    @property
    def is_boundary(self) -> bool:
        return self.face.is_boundary

    @staticmethod
    def connect(e1: "HalfEdge", e2: "HalfEdge") -> None:
        e1.next = e2
        e2.prev = e1

    def walk(self) -> Iterator["HalfEdge"]:
        edge = self
        while True:
            yield edge
            edge = edge.next
            if edge == self:
                break

    def cotan(self) -> float:
        if self.twin is None or self.next is None or self.next.next is None:
            return 0.
        if self.twin.next is None or self.twin.next.next is None:
            return 0.
        vertex_i = self.origin
        vertex_k = self.twin.origin
        ratio = 0.
        for other in [self.next.next, self.twin.next.next]:
            if other.next is None or other.next.face is None or other.next.face.is_boundary:
                continue
            vi = vertex_i.p - other.origin.p
            vk = vertex_k.p - other.origin.p
            ratio += abs(vi.dot(vk) / (vi ^ vk)) / 2
        return ratio


@dataclass(eq=False)
class Face:
    edge: Optional[HalfEdge] = None
    is_boundary: bool = False
    i: IndexType = field(default=IndexType(0))

    @property
    def edges(self):
        edge = self.edge
        while True:
            yield edge
            edge = edge.next
            if edge == self.edge:
                break

    @property
    def vertices(self):
        for edge in self.edges:
            yield edge.origin

    @property
    def centroid(self) -> Point:
        x_sum = 0.0
        y_sum = 0.0
        count = 0
        for vertex in self.vertices:
            x_sum += vertex.p.x
            y_sum += vertex.p.y
            count += 1
        return Point(x_sum / count, y_sum / count)

    @property
    def area(self) -> float:
        area = 0.0
        for edge in self.edges:
            p1 = edge.origin.p
            p2 = edge.next.origin.p
            area += (p1.x * p2.y - p2.x * p1.y)
        return 0.5 * abs(area)


class IndexStore:
    def __init__(self):
        self._idx_to_obj: list = []

    @property
    def next_index(self) -> IndexType:
        return len(self._idx_to_obj)

    def add(self, obj) -> None:
        obj.i = self.next_index
        self._idx_to_obj.append(obj)

    def to_index(self, obj) -> IndexType:
        return obj.i

    def to_object(self, idx: int) -> HasIndex:
        return self._idx_to_obj[int(idx)]

    def __len__(self) -> int:
        return len(self._idx_to_obj)

    def __iter__(self) -> Iterator:
        return iter(self._idx_to_obj)

    def __contains__(self, obj) -> bool:
        return 0 <= obj.i < len(self._idx_to_obj) and self._idx_to_obj[obj.i] is obj

    def items(self) -> Iterator[Tuple[IndexType, HasIndex]]:
        for idx, obj in enumerate(self._idx_to_obj):
            yield idx, obj


class Mesh:
    def __init__(self):
        self.vertices = IndexStore()
        self.halfedges = IndexStore()
        self.faces = IndexStore()
        self.boundaries = IndexStore()
        self._edge_map: Dict[Tuple[int, int], HalfEdge] = {}

    def make_vertex(self, p: Point) -> Vertex:
        v = Vertex(p)
        self.vertices.add(v)
        return v

    def connect_vertices(self, v1: Vertex, v2: Vertex) -> HalfEdge:
        key12 = (self.vertices.to_index(v1), self.vertices.to_index(v2))
        key21 = (key12[1], key12[0])

        if key12 in self._edge_map:
            return self._edge_map[key12]

        e12 = HalfEdge(v1)
        self.halfedges.add(e12)
        e21 = HalfEdge(v2)
        self.halfedges.add(e21)
        e12.twin = e21
        e21.twin = e12

        self._edge_map[key12] = e12
        self._edge_map[key21] = e21

        if v1.out is None:
            v1.out = e12
        if v2.out is None:
            v2.out = e21

        return e12

    def euler_characteristic(self) -> int:
        return len(self.vertices) - len(self.halfedges) // 2 + len(self.faces)

    @classmethod
    def from_triangle_soup(cls, points: List[Point],
                           triangles: List[Tuple[int, int, int]]) -> "Mesh":
        mesh = cls()
        vertices = [mesh.make_vertex(p) for p in points]

        for tri in triangles:
            assert len(tri) == 3
            v1, v2, v3 = [vertices[i] for i in tri]

            vertex_edge_pairs = [(v1, v2), (v2, v3), (v3, v1)]
            face = Face()
            mesh.faces.add(face)
            current_hedges = []
            for u, v in vertex_edge_pairs:
                hedge = mesh.connect_vertices(u, v)
                u.out = hedge
                face.edge = hedge
                hedge.face = face
                current_hedges.append(hedge)

            for h1, h2 in zip(current_hedges, current_hedges[1:] + [current_hedges[0]]):
                HalfEdge.connect(h1, h2)

        boundary_hedges = set()
        vertex_to_boundary_hedge = {}
        for hedge in mesh.halfedges:
            if hedge.face is not None:
                continue
            boundary_hedges.add(hedge)

            if hedge.origin in vertex_to_boundary_hedge:
                continue

            vertex_to_boundary_hedge[hedge.origin] = hedge

        boundary_hedges = set(hedge for hedge in mesh.halfedges if hedge.face is None)
        while boundary_hedges:
            hedge = boundary_hedges.pop()

            face = Face(is_boundary=True)
            mesh.boundaries.add(face)
            face.edge = hedge
            hedge.face = face

            hedge_prev = hedge
            while True:
                vertex_next = hedge_prev.twin.origin
                hedge_next = vertex_to_boundary_hedge.get(vertex_next)
                if hedge_next not in boundary_hedges:
                    break

                boundary_hedges.remove(hedge_next)
                HalfEdge.connect(hedge_prev, hedge_next)
                hedge_next.face = face
                hedge_prev = hedge_next

            HalfEdge.connect(hedge_prev, hedge)

        return mesh


@dataclass
class ZeroForm:
    mesh: Mesh
    values: list = field(init=False, repr=False)

    def __post_init__(self):
        self.values = [0.0] * len(self.mesh.vertices)

    def __getitem__(self, vertex: Vertex) -> float:
        if vertex not in self.mesh.vertices:
            raise KeyError("Vertex not in mesh")
        return self.values[vertex.i]

    def __setitem__(self, vertex: Vertex, value: float) -> None:
        if vertex not in self.mesh.vertices:
            raise KeyError("Vertex not in mesh")
        self.values[vertex.i] = value

    def __add__(self, other: "ZeroForm") -> "ZeroForm":
        if self.mesh is not other.mesh:
            raise ValueError("Cannot add ZeroForms on different meshes")
        result = ZeroForm(self.mesh)
        result.values = [a + b for a, b in zip(self.values, other.values)]
        return result

    def __sub__(self, other: "ZeroForm") -> "ZeroForm":
        if self.mesh is not other.mesh:
            raise ValueError("Cannot subtract ZeroForms on different meshes")
        result = ZeroForm(self.mesh)
        result.values = [a - b for a, b in zip(self.values, other.values)]
        return result

    def __mul__(self, scalar: float) -> "ZeroForm":
        result = ZeroForm(self.mesh)
        result.values = [v * scalar for v in self.values]
        return result

    def __rmul__(self, scalar: float) -> "ZeroForm":
        return self.__mul__(scalar)

    def __truediv__(self, scalar: float) -> "ZeroForm":
        if scalar == 0:
            raise ZeroDivisionError("Cannot divide ZeroForm by zero")
        result = ZeroForm(self.mesh)
        result.values = [v / scalar for v in self.values]
        return result

    def __neg__(self) -> "ZeroForm":
        result = ZeroForm(self.mesh)
        result.values = [-v for v in self.values]
        return result

    def d(self) -> "OneForm":
        one_form = OneForm(self.mesh)
        for hedge in self.mesh.halfedges:
            target_value = self.values[hedge.twin.origin.i]
            source_value = self.values[hedge.origin.i]
            one_form.values[hedge.i] = target_value - source_value
        return one_form


@dataclass
class OneForm:
    mesh: Mesh
    values: list = field(init=False, repr=False)

    def __post_init__(self):
        self.values = [0.0] * len(self.mesh.halfedges)

    def __getitem__(self, hedge: HalfEdge) -> float:
        if hedge not in self.mesh.halfedges:
            raise KeyError("HalfEdge not in mesh")
        return self.values[hedge.i]

    def __setitem__(self, hedge: HalfEdge, value: float) -> None:
        if hedge not in self.mesh.halfedges:
            raise KeyError("HalfEdge not in mesh")
        self.values[hedge.i] = value
        self.values[hedge.twin.i] = -value

    def __add__(self, other: "OneForm") -> "OneForm":
        if self.mesh is not other.mesh:
            raise ValueError("Cannot add OneForms on different meshes")
        result = OneForm(self.mesh)
        result.values = [a + b for a, b in zip(self.values, other.values)]
        return result

    def __sub__(self, other: "OneForm") -> "OneForm":
        if self.mesh is not other.mesh:
            raise ValueError("Cannot subtract OneForms on different meshes")
        result = OneForm(self.mesh)
        result.values = [a - b for a, b in zip(self.values, other.values)]
        return result

    def __mul__(self, scalar: float) -> "OneForm":
        result = OneForm(self.mesh)
        result.values = [v * scalar for v in self.values]
        return result

    def __rmul__(self, scalar: float) -> "OneForm":
        return self.__mul__(scalar)

    def __truediv__(self, scalar: float) -> "OneForm":
        if scalar == 0:
            raise ZeroDivisionError("Cannot divide OneForm by zero")
        result = OneForm(self.mesh)
        result.values = [v / scalar for v in self.values]
        return result

    def __neg__(self) -> "OneForm":
        result = OneForm(self.mesh)
        result.values = [-v for v in self.values]
        return result


@dataclass
class TwoForm:
    mesh: Mesh
    values: list = field(init=False, repr=False)

    def __post_init__(self):
        self.values = [0.0] * len(self.mesh.faces)

    def __getitem__(self, face: Face) -> float:
        if face not in self.mesh.faces and face not in self.mesh.boundaries:
            raise KeyError("Face not in mesh")
        if face in self.mesh.boundaries:
            return 0.0
        return self.values[face.i]

    def __setitem__(self, face: Face, value: float) -> None:
        if face not in self.mesh.faces:
            raise KeyError("Face not in mesh.faces")
        self.values[face.i] = value

    def __add__(self, other: "TwoForm") -> "TwoForm":
        if self.mesh is not other.mesh:
            raise ValueError("Cannot add TwoForms on different meshes")
        result = TwoForm(self.mesh)
        result.values = [a + b for a, b in zip(self.values, other.values)]
        return result

    def __sub__(self, other: "TwoForm") -> "TwoForm":
        if self.mesh is not other.mesh:
            raise ValueError("Cannot subtract TwoForms on different meshes")
        result = TwoForm(self.mesh)
        result.values = [a - b for a, b in zip(self.values, other.values)]
        return result

    def __mul__(self, scalar: float) -> "TwoForm":
        result = TwoForm(self.mesh)
        result.values = [v * scalar for v in self.values]
        return result

    def __rmul__(self, scalar: float) -> "TwoForm":
        return self.__mul__(scalar)

    def __truediv__(self, scalar: float) -> "TwoForm":
        if scalar == 0:
            raise ZeroDivisionError("Cannot divide TwoForm by zero")
        result = TwoForm(self.mesh)
        result.values = [v / scalar for v in self.values]
        return result

    def __neg__(self) -> "TwoForm":
        result = TwoForm(self.mesh)
        result.values = [-v for v in self.values]
        return result


class MeshingException(RuntimeError):
    pass


class Mesher:
    @dataclass(frozen=True)
    class Config:
        minimum_angle: float = 20.0
        maximum_size: float = 0.6
        variable_density_min_distance: float = 0.5
        variable_density_max_distance: float = 3.0
        variable_size_maximum_factor: float = 3.0
        distance_map_quantization: float = 1.0

        RELAXED = None

        @property
        def is_variable_density(self) -> bool:
            return self.variable_size_maximum_factor != 1.0

    def __init__(self, config: Optional["Mesher.Config"] = None):
        self.config = config if config is not None else Mesher.Config()

    def poly_to_mesh(self, poly: shapely.geometry.Polygon,
                     seed_points: List[Point] = []) -> Mesh:
        if poly.is_empty or poly.area < 1e-10:
            return Mesh()

        if self.config.maximum_size <= 0:
            return self._earcut_triangulate(poly)

        try:
            return self._adaptive_triangulate(poly, seed_points)
        except Exception:
            return self._earcut_triangulate(poly)

    def _adaptive_triangulate(self, poly, seed_points):
        from scipy.spatial import Delaunay, KDTree

        min_size = self.config.maximum_size
        max_size = min_size * self.config.variable_size_maximum_factor
        min_dist = self.config.variable_density_min_distance
        max_dist = self.config.variable_density_max_distance
        MAX_VERTICES = 20000

        has_seeds = len(seed_points) > 0
        seed_tree = KDTree([(p.x, p.y) for p in seed_points]) if has_seeds else None

        def target_vec(xx, yy):
            if not has_seeds:
                return np.full(len(xx), max_size, dtype=float)
            dists = seed_tree.query(np.column_stack([xx, yy]))[0]
            t = np.clip((dists - min_dist) / (max_dist - min_dist), 0.0, 1.0)
            return min_size + t * (max_size - min_size)

        def target_one(x, y):
            if not has_seeds:
                return max_size
            d = seed_tree.query([[x, y]])[0][0]
            t = min(1.0, max(0.0, (d - min_dist) / (max_dist - min_dist)))
            return min_size + t * (max_size - min_size)

        # Densify boundary by recursive edge subdivision
        def subdivide(ax, ay, bx, by):
            length = math.hypot(bx - ax, by - ay)
            if length < 1e-12:
                return [(ax, ay)]
            mx, my = (ax + bx) / 2, (ay + by) / 2
            ts = target_one(mx, my)
            if length <= ts * 1.5:
                return [(ax, ay)]
            return subdivide(ax, ay, mx, my) + subdivide(mx, my, bx, by)

        boundary = []
        for ring in [poly.exterior] + list(poly.interiors):
            coords = list(ring.coords)[:-1]
            n = len(coords)
            for i in range(n):
                x1, y1 = coords[i]
                x2, y2 = coords[(i + 1) % n]
                boundary.extend(subdivide(x1, y1, x2, y2))

        # Interior adaptive grid
        bounds = poly.bounds
        spacing = min_size
        area = poly.area
        if area / (spacing * spacing) > MAX_VERTICES * 0.6:
            spacing = math.sqrt(area / (MAX_VERTICES * 0.6))

        xs = np.arange(bounds[0], bounds[2] + spacing, spacing)
        ys = np.arange(bounds[1], bounds[3] + spacing, spacing)
        n_x, n_y = len(xs), len(ys)

        xx, yy = np.meshgrid(xs, ys, indexing='ij')
        xf, yf = xx.ravel(), yy.ravel()

        targets = target_vec(xf, yf)
        levels = np.maximum(1, np.round(targets / spacing)).astype(int)

        iix, iiy = np.meshgrid(np.arange(n_x), np.arange(n_y), indexing='ij')
        keep = (iix.ravel() % levels == 0) & (iiy.ravel() % levels == 0)

        cx, cy = xf[keep], yf[keep]

        from shapely.prepared import prep
        prepared = prep(poly)

        interior = [
            (float(x), float(y))
            for x, y in zip(cx, cy)
            if prepared.contains(shapely.geometry.Point(float(x), float(y)))
        ]

        # Merge boundary + interior + seeds, deduplicate
        seen = {}
        pts = []

        def add(x, y):
            key = (round(x, 4), round(y, 4))
            if key not in seen:
                seen[key] = len(pts)
                pts.append((float(x), float(y)))

        for x, y in boundary:
            add(x, y)
        for x, y in interior:
            add(x, y)
        for p in seed_points:
            add(p.x, p.y)

        if len(pts) > MAX_VERTICES or len(pts) < 3:
            return self._earcut_triangulate(poly)

        arr = np.array(pts)
        tri = Delaunay(arr)

        valid = []
        used_set = set()
        for s in tri.simplices:
            centroid = shapely.geometry.Point(
                float(arr[s, 0].mean()), float(arr[s, 1].mean())
            )
            if prepared.contains(centroid):
                a, b, c = int(s[0]), int(s[1]), int(s[2])
                if a != b and b != c and c != a:
                    area = abs(
                        (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1])
                        - (pts[c][0] - pts[a][0]) * (pts[b][1] - pts[a][1])
                    )
                    if area > 1e-10:
                        valid.append((a, b, c))
                        used_set.update([a, b, c])

        if not valid:
            return self._earcut_triangulate(poly)

        # Remap to remove isolated vertices
        used_list = sorted(used_set)
        old_to_new = {old: new for new, old in enumerate(used_list)}
        final_pts = [pts[i] for i in used_list]
        final_tri = [(old_to_new[a], old_to_new[b], old_to_new[c]) for a, b, c in valid]

        # Verify seed points survived the clipping
        if has_seeds:
            seed_keys = {(round(p.x, 4), round(p.y, 4)) for p in seed_points}
            final_keys = {(round(x, 4), round(y, 4)) for x, y in final_pts}
            if not seed_keys.issubset(final_keys):
                return self._earcut_triangulate(poly)

        mesh_points = [Point(x, y) for x, y in final_pts]
        return Mesh.from_triangle_soup(mesh_points, final_tri)

    def _earcut_triangulate(self, poly):
        import trimesh

        try:
            vertices, faces = trimesh.creation.triangulate_polygon(poly, engine='earcut')
        except Exception:
            try:
                vertices, faces = trimesh.creation.triangulate_polygon(
                    poly.buffer(0), engine='earcut'
                )
            except Exception:
                return Mesh()

        if len(faces) == 0:
            return Mesh()

        unique_map = {}
        remap = {}
        unique_verts = []
        for i in range(len(vertices)):
            key = (round(float(vertices[i][0]), 4), round(float(vertices[i][1]), 4))
            if key in unique_map:
                remap[i] = unique_map[key]
            else:
                new_idx = len(unique_verts)
                unique_map[key] = new_idx
                unique_verts.append(vertices[i])
                remap[i] = new_idx

        triangles = []
        for face in faces:
            tri = tuple(remap[int(face[i])] for i in range(3))
            if tri[0] != tri[1] and tri[1] != tri[2] and tri[2] != tri[0]:
                triangles.append(tri)

        if not triangles:
            return Mesh()

        mesh_points = [Point(float(v[0]), float(v[1])) for v in unique_verts]
        return Mesh.from_triangle_soup(mesh_points, triangles)


Mesher.Config.RELAXED = Mesher.Config(
    minimum_angle=5.0,
    maximum_size=0,
    variable_size_maximum_factor=1.0
)
