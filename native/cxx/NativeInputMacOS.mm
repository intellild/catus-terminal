#include "NativeInputElement.h"

#import <Cocoa/Cocoa.h>

// The C++ view owns this delegate; NSTextField's delegate reference is weak.
@interface CatusInputDelegate : NSObject <NSTextFieldDelegate>
@property(nonatomic, copy) void (^onInput)(NSString* value);
@end

@implementation CatusInputDelegate
- (void)controlTextDidChange:(NSNotification*)notification {
  NSTextField* input = notification.object;
  if (self.onInput != nil) {
    self.onInput(input.stringValue);
  }
}
@end

namespace {

void RunOnMainThreadSync(void (^block)(void)) {
  if ([NSThread isMainThread]) {
    block();
  } else {
    dispatch_sync(dispatch_get_main_queue(), block);
  }
}

NSString* NSStringFromStdString(const std::string& value) {
  NSString* result = [NSString stringWithUTF8String:value.c_str()];
  return result != nil ? result : @"";
}

class NativeInputMacOSView : public NativeInputElementView {
 public:
  explicit NativeInputMacOSView(void* opaque)
      : NativeInputElementView(opaque) {
    RunOnMainThreadSync(^{
      input_ = [[NSTextField alloc] initWithFrame:NSZeroRect];
      input_.editable = YES;
      input_.selectable = YES;
      input_.bezeled = YES;
      input_.bezelStyle = NSTextFieldRoundedBezel;
      input_.font = [NSFont systemFontOfSize:16];
      input_.textColor = [NSColor labelColor];
      input_.backgroundColor = [NSColor textBackgroundColor];
      input_.placeholderString = @"Type in the native input";
      input_.stringValue = NSStringFromStdString(value());
      input_.accessibilityLabel = @"Native input";
      delegate_ = [[CatusInputDelegate alloc] init];
      delegate_.onInput = ^(NSString* text) {
        const char* utf8 = text.UTF8String;
        HandleNativeInput(utf8 != nullptr ? utf8 : "");
      };
      input_.delegate = delegate_;
    });
  }

  ~NativeInputMacOSView() override {
    RunOnMainThreadSync(^{
      delegate_.onInput = nil;
      input_.delegate = nil;
      [input_ removeFromSuperview];
      input_ = nil;
      delegate_ = nil;
    });
  }

  bool IsSurfaceEnabled() override { return false; }

  void OnAttach() override {
    RunOnMainThreadSync(^{ AttachToParent(); });
  }

  void OnDetach() override {
    RunOnMainThreadSync(^{ [input_ removeFromSuperview]; });
  }

  void OnLayoutChanged(float left, float top, float width, float height,
                       float pixel_ratio) override {
    (void)pixel_ratio;
    RunOnMainThreadSync(^{
      NSView* parent = AttachToParent();
      if (parent != nil) {
        input_.frame = NSMakeRect(left, top, width, height);
      }
    });
  }

 private:
  void OnValueChanged(const std::string& value) override {
    std::string text = value;
    RunOnMainThreadSync(^{
      NSString* next = NSStringFromStdString(text);
      // Avoid resetting selection or marked text when React echoes an input event.
      if (![input_.stringValue isEqualToString:next]) {
        input_.stringValue = next;
      }
    });
  }

  void OnPlaceholderChanged(const std::string& value) override {
    std::string text = value;
    RunOnMainThreadSync(^{
      input_.placeholderString = NSStringFromStdString(text);
    });
  }

  bool Focus() override {
    __block bool focused = false;
    RunOnMainThreadSync(^{
      if (input_.window != nil) {
        focused = [input_.window makeFirstResponder:input_];
      }
    });
    return focused;
  }

  NSView* AttachToParent() {
    if (lynx_view() == nullptr || input_ == nil) {
      return nil;
    }
    NSView* parent = (__bridge NSView*)lynx_view_get_native_window(lynx_view());
    if (parent != nil && input_.superview != parent) {
      [input_ removeFromSuperview];
      // Attach to this LynxView's renderer, as required by the Desktop C API.
      [parent addSubview:input_];
    }
    return parent;
  }

  NSTextField* input_ = nil;
  CatusInputDelegate* delegate_ = nil;
};

}  // namespace

lynx_native_view_t* CreateNativeInputMacOSView(void* opaque) {
  return (new NativeInputMacOSView(opaque))->native_view();
}
