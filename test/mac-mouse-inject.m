// mac-mouse-inject.m: posts synthetic mouse moves for mac-raw-input-test.js,
// the macOS check of c12 (KccPinRawPointerLock) and c15
// (KccLeanLockedMouseMove).
//
// mac-build-mouse-inject.sh builds it into a background-only app,
// KccMouseInject.app. macOS lets a process post input events only with the
// Accessibility permission. An app started through LaunchServices (`open`) is
// its own client for that permission, so the permission goes to this small app
// only, not to the terminal or tool that runs the test.
//
//   open -g -W -n KccMouseInject.app --args --out FILE --check
//   open -g -W -n KccMouseInject.app --args --out FILE --request
//   open -g -W -n KccMouseInject.app --args --out FILE --pid PID
//        --plan "count,ax,ay,ux,uy,intervalUs[;...]" [--tap hid|session|pid]
//
// --check writes whether this app may post events. --request also shows the
// system prompt that adds it to Privacy & Security > Accessibility, where it
// stays off until the user turns it on.
//
// The only events it creates are kCGEventMouseMoved: no button, key or wheel
// event. Each carries (ax, ay) in kCGMouseEventDeltaX/Y, which NSEvent.deltaX/Y
// return (the accelerated movement of a real mouse event), and (ux, uy) in
// kCGEventUnacceleratedPointerMovementX/Y, which Chromium reads instead while a
// pointer lock with unadjustedMovement is held
// (components/input/web_input_event_builders_mac.mm). With different values in
// the two pairs, the movement a page sees tells which of the two an event took.
// The event position is the current cursor position, so the cursor is not
// moved.
//
// Guards: --pid must be a running app with the bundle id com.github.Electron,
// and it must be the frontmost app before the first event and every 8 events
// after it. Otherwise the phase stops, so input never goes to another
// application. At most 2000 events per call, |delta| <= 50.
//
// Writes one line per phase to --out: "OK <n> events in <ms> ms", "ABORT ...",
// "NOACCESS ..." or "ERROR ...". Exit code 0 when every phase was OK, 1 when a
// phase was not, 2 for bad arguments, 3 without the permission.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#include <mach/mach_time.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static const int kMaxEvents = 2000;
static const int kMaxDelta = 50;
static const int kCheckEvery = 8;
static NSString* const kTargetBundleId = @"com.github.Electron";

typedef enum { kTapHid, kTapSession, kTapPid } Tap;

static FILE* g_out = NULL;

static void Say(NSString* line) {
  FILE* f = g_out ? g_out : stdout;
  fprintf(f, "%s\n", line.UTF8String);
  fflush(f);
}

// The pid of the app with keyboard focus: from the accessibility API, or from
// NSWorkspace when that is not available.
static pid_t FrontmostPid(void) {
  pid_t pid = -1;
  AXUIElementRef sys = AXUIElementCreateSystemWide();
  if (sys) {
    AXUIElementSetMessagingTimeout(sys, 0.25f);
    CFTypeRef app = NULL;
    if (AXUIElementCopyAttributeValue(sys, kAXFocusedApplicationAttribute, &app) == kAXErrorSuccess && app) {
      if (AXUIElementGetPid((AXUIElementRef)app, &pid) != kAXErrorSuccess) pid = -1;
      CFRelease(app);
    }
    CFRelease(sys);
  }
  if (pid > 0) return pid;
  CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true);
  NSRunningApplication* front = NSWorkspace.sharedWorkspace.frontmostApplication;
  return front ? front.processIdentifier : -1;
}

static CGPoint CursorPosition(void) {
  CGEventRef e = CGEventCreate(NULL);
  CGPoint p = e ? CGEventGetLocation(e) : CGPointZero;
  if (e) CFRelease(e);
  return p;
}

static NSString* RunPhase(pid_t target, Tap tap, int count, int ax, int ay, int ux, int uy, int interval_us,
                          int* budget) {
  if (count < 1 || interval_us < 100 || interval_us > 1000000) return @"ERROR bad count or interval";
  if (abs(ax) > kMaxDelta || abs(ay) > kMaxDelta || abs(ux) > kMaxDelta || abs(uy) > kMaxDelta)
    return [NSString stringWithFormat:@"ERROR a delta is above %d", kMaxDelta];
  if (count > *budget) return [NSString stringWithFormat:@"ERROR more than %d events in one call", kMaxEvents];
  *budget -= count;
  CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStateHIDSystemState);
  if (!src) return @"ERROR CGEventSourceCreate failed";
  const CGPoint pos = CursorPosition();
  mach_timebase_info_data_t tb;
  mach_timebase_info(&tb);
  const uint64_t step = (uint64_t)interval_us * 1000ull * tb.denom / tb.numer;
  const uint64_t t0 = mach_absolute_time();
  uint64_t next = t0;
  int sent = 0;
  for (int i = 0; i < count; i++) {
    if (i % kCheckEvery == 0) {
      const pid_t fg = FrontmostPid();
      if (fg != target) {
        CFRelease(src);
        return [NSString stringWithFormat:@"ABORT the frontmost app is pid %d, after %d events", fg, sent];
      }
    }
    CGEventRef e = CGEventCreateMouseEvent(src, kCGEventMouseMoved, pos, kCGMouseButtonLeft);
    if (!e) {
      CFRelease(src);
      return [NSString stringWithFormat:@"ERROR CGEventCreateMouseEvent failed after %d events", sent];
    }
    CGEventSetIntegerValueField(e, kCGMouseEventDeltaX, ax);
    CGEventSetIntegerValueField(e, kCGMouseEventDeltaY, ay);
    CGEventSetIntegerValueField(e, kCGEventUnacceleratedPointerMovementX, ux);
    CGEventSetIntegerValueField(e, kCGEventUnacceleratedPointerMovementY, uy);
    if (tap == kTapPid) {
      CGEventPostToPid(target, e);
    } else {
      CGEventPost(tap == kTapHid ? kCGHIDEventTap : kCGSessionEventTap, e);
    }
    CFRelease(e);
    sent++;
    next += step;
    mach_wait_until(next);
  }
  CFRelease(src);
  const double ms = (double)(mach_absolute_time() - t0) * tb.numer / tb.denom / 1e6;
  return [NSString stringWithFormat:@"OK %d events in %.0f ms", sent, ms];
}

int main(int argc, const char* argv[]) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];

    const char* out_path = NULL;
    NSString* plan = nil;
    NSString* tap_name = @"hid";
    pid_t target = 0;
    BOOL check = NO, request = NO;
    NSString* bad = nil;
    for (int i = 1; i < argc; i++) {
      const char* a = argv[i];
      const char* v = i + 1 < argc ? argv[i + 1] : NULL;
      if (!strcmp(a, "--out") && v) {
        out_path = v;
        i++;
      } else if (!strcmp(a, "--pid") && v) {
        target = (pid_t)atoi(v);
        i++;
      } else if (!strcmp(a, "--plan") && v) {
        plan = @(v);
        i++;
      } else if (!strcmp(a, "--tap") && v) {
        tap_name = @(v);
        i++;
      } else if (!strcmp(a, "--check")) {
        check = YES;
      } else if (!strcmp(a, "--request")) {
        request = YES;
      } else if (strncmp(a, "-psn_", 5) != 0) {
        bad = @(a);
      }
    }
    if (out_path) {
      g_out = fopen(out_path, "w");
      if (!g_out) return 2;
    }
    if (bad) {
      Say([NSString stringWithFormat:@"ERROR unexpected argument %@", bad]);
      return 2;
    }

    BOOL post = CGPreflightPostEventAccess();
    BOOL trusted = AXIsProcessTrusted();
    if (check || request) {
      if (request && !trusted) {
        NSDictionary* opts = @{(__bridge NSString*)kAXTrustedCheckOptionPrompt : @YES};
        trusted = AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)opts);
      } else if (request && !post) {
        post = CGRequestPostEventAccess();
      }
      Say([NSString stringWithFormat:@"ACCESS postEvent=%d accessibility=%d", post, trusted]);
      return post ? 0 : 3;
    }
    if (!post) {
      Say(@"NOACCESS this app may not post events (Privacy & Security > Accessibility)");
      return 3;
    }

    if (target <= 0 || !plan) {
      Say(@"ERROR --pid and --plan are required");
      return 2;
    }
    NSRunningApplication* app = [NSRunningApplication runningApplicationWithProcessIdentifier:target];
    if (!app || ![app.bundleIdentifier isEqualToString:kTargetBundleId]) {
      Say([NSString stringWithFormat:@"ERROR pid %d is not a running %@ app", target, kTargetBundleId]);
      return 2;
    }
    Tap tap;
    if ([tap_name isEqualToString:@"hid"]) {
      tap = kTapHid;
    } else if ([tap_name isEqualToString:@"session"]) {
      tap = kTapSession;
    } else if ([tap_name isEqualToString:@"pid"]) {
      tap = kTapPid;
    } else {
      Say([NSString stringWithFormat:@"ERROR unknown --tap %@", tap_name]);
      return 2;
    }

    int budget = kMaxEvents;
    for (NSString* phase in [plan componentsSeparatedByString:@";"]) {
      if (!phase.length) continue;
      NSArray<NSString*>* p = [phase componentsSeparatedByString:@","];
      if (p.count != 6) {
        Say(@"ERROR a phase is count,ax,ay,ux,uy,intervalUs");
        return 2;
      }
      NSString* r = RunPhase(target, tap, p[0].intValue, p[1].intValue, p[2].intValue, p[3].intValue,
                             p[4].intValue, p[5].intValue, &budget);
      Say(r);
      if (![r hasPrefix:@"OK "]) return 1;
    }
    return 0;
  }
}
