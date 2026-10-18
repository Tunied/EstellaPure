// The edges a wireframe draws: every distinct edge of a triangle list once, in order, and
// nothing a seam or a shared edge could double.

#include "esengine/resource/MeshEdges.hpp"

#include <cstdio>
#include <vector>

using namespace esengine;

static int g_failures = 0;
#define CHECK(cond, msg)                                                        \
    do {                                                                        \
        if (!(cond)) { std::printf("FAIL: %s\n", msg); ++g_failures; }          \
        else { std::printf("ok:   %s\n", msg); }                                \
    } while (0)

int main() {
    const std::vector<u32> none;
    CHECK(distinctMeshEdges(none).empty(), "no triangles, no edges");

    const std::vector<u32> one = {0, 1, 2};
    const auto e1 = distinctMeshEdges(one);
    CHECK(e1.size() == 6, "one triangle has three edges");
    CHECK((e1 == std::vector<u32>{0, 1, 0, 2, 1, 2}), "listed low vertex first, in ascending order");

    // Two triangles sharing the 1-2 edge: a quad. Five edges, the diagonal once.
    const std::vector<u32> quad = {0, 1, 2, 2, 1, 3};
    const auto eq = distinctMeshEdges(quad);
    CHECK(eq.size() == 10, "a quad is five edges: four sides and one diagonal");
    int diagonal = 0;
    for (usize i = 0; i < eq.size(); i += 2) diagonal += (eq[i] == 1 && eq[i + 1] == 2) ? 1 : 0;
    CHECK(diagonal == 1, "an edge two triangles share is one line, not two");

    // The same quad with the diagonal's vertices split by a seam (2 and 4 are one place, 1 and 5 too):
    // vertex indices differ, so the two copies of the diagonal are two edges. That is a rim.
    const std::vector<u32> seamed = {0, 1, 2, 4, 5, 3};
    CHECK(distinctMeshEdges(seamed).size() == 12, "a seam that splits vertices keeps both copies of the edge");

    // A triangle count that is not a multiple of three drops the trailing indices rather than reading past.
    const std::vector<u32> ragged = {0, 1, 2, 3, 4};
    CHECK(distinctMeshEdges(ragged).size() == 6, "trailing indices short of a triangle are ignored");

    // A cube of twelve triangles has eighteen edges (twelve sides and six face diagonals).
    const std::vector<u32> cube = {
        0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 5, 1, 0, 4, 5,
        3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
    };
    CHECK(distinctMeshEdges(cube).size() == 36, "a closed cube of twelve triangles has eighteen edges");

    if (g_failures) {
        std::printf("%d failure(s)\n", g_failures);
        return 1;
    }
    std::printf("all mesh edge checks passed\n");
    return 0;
}
