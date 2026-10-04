#pragma once
#include <capi/lynx_view_capi.h>
#include <lynx_vsync_monitor.h>

namespace catus {
// macOS 14+ display links must be scheduled on the UI run loop in Lynxtron.
std::shared_ptr<lynx::pub::LynxVSyncMonitor> InstallVSyncMonitor(lynx_view_t* view);
void StopVSyncMonitor(const std::shared_ptr<lynx::pub::LynxVSyncMonitor>& monitor);
}
