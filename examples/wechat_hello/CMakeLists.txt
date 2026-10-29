cmake_minimum_required(VERSION 3.24)
project(EstellaWeChatHello LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
if(NOT EMSCRIPTEN)
  message(FATAL_ERROR "Use scripts/build-wechat-hello.cjs with Emscripten")
endif()
get_filename_component(ESENGINE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../.." ABSOLUTE)
# Compile the upstream C++ core directly; no SDK, editor, generated bindings or
# source changes are needed for this deliberately small device comparison.
set(ES_BUILD_WXGAME ON)
set(ES_BUILD_WEB OFF)
set(ES_ENABLE_BITMAP_TEXT OFF)
set(ES_ENABLE_TILEMAP OFF)
set(ES_ENABLE_PARTICLES OFF)
set(ES_ENABLE_POSTPROCESS OFF)
set(ES_ENABLE_WEBGPU OFF)
include("${ESENGINE_ROOT}/cmake/ESEngineSources.cmake")
file(GLOB_RECURSE YOGA_SOURCES CONFIGURE_DEPENDS "${ESENGINE_ROOT}/third_party/yoga/*.cpp")
add_library(estella_hello_core STATIC ${ESENGINE_SOURCES} ${YOGA_SOURCES})
target_include_directories(estella_hello_core PUBLIC
  "${ESENGINE_ROOT}/src" "${ESENGINE_ROOT}/third_party"
  "${ESENGINE_ROOT}/third_party/glm" "${ESENGINE_ROOT}/third_party/stb")
target_compile_definitions(estella_hello_core PUBLIC ES_PLATFORM_WEB ES_PLATFORM_WXGAME
  GLM_FORCE_RADIANS GLM_FORCE_DEPTH_ZERO_TO_ONE GLM_ENABLE_EXPERIMENTAL)
target_compile_options(estella_hello_core PRIVATE -fno-exceptions)
add_executable(estella_hello main.cpp)
target_link_libraries(estella_hello PRIVATE estella_hello_core)
target_compile_options(estella_hello PRIVATE -fno-exceptions)
target_link_options(estella_hello PRIVATE --no-entry
  -sMODULARIZE=1 -sEXPORT_NAME=EstellaHelloModule -sENVIRONMENT=web
  -sEXPORT_ES6=0 -sDYNAMIC_EXECUTION=0 -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2
  -sFULL_ES3=1 -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432
  -sMAXIMUM_MEMORY=268435456 -sSTACK_SIZE=1048576 -sWASM_BIGINT=0
  -sASSERTIONS=1 -sSTACK_OVERFLOW_CHECK=2 -sABORTING_MALLOC=0
  "-sEXPORTED_FUNCTIONS=['_eh_init','_eh_frame','_eh_resize','_eh_touch','_eh_shutdown','_eh_heap_bytes']"
  "-sEXPORTED_RUNTIME_METHODS=['GL','HEAPU8']"
  "--extern-pre-js=${CMAKE_CURRENT_SOURCE_DIR}/pre.js")
set_target_properties(estella_hello PROPERTIES SUFFIX ".js" OUTPUT_NAME "estella-hello"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
