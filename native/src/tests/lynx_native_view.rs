use super::*;
use crate::binding::protocol::Property;
use std::cell::{Cell, RefCell};

#[path = "lynx_native_view_host.rs"]
mod host;
#[path = "lynx_value_host.rs"]
mod values;

#[derive(Default)]
struct ProbeState {
    events: RefCell<Vec<String>>,
    drops: Cell<usize>,
}
struct Probe {
    state: Rc<ProbeState>,
    handle: Handle,
}
impl NativeView for Probe {
    fn on_attach(&self) -> Result<()> {
        self.state.events.borrow_mut().push("attach".into());
        Ok(())
    }
    fn on_detach(&self) -> Result<()> {
        self.state.events.borrow_mut().push("detach".into());
        Ok(())
    }
    fn on_destroy(&self) -> Result<()> {
        self.state.events.borrow_mut().push("destroy".into());
        Ok(())
    }
    fn on_layout_changed(&self, layout: Layout) -> Result<()> {
        assert_eq!(
            (
                layout.left,
                layout.top,
                layout.width,
                layout.height,
                layout.pixel_ratio
            ),
            (1., 2., 200., 100., 2.)
        );
        self.state.events.borrow_mut().push("layout".into());
        Ok(())
    }
    fn on_properties_changed(&self, attrs: &Value, _events: &Value) -> Result<()> {
        self.state
            .events
            .borrow_mut()
            .push(attrs.get(Property::Text)?.string()?);
        Ok(())
    }
    fn on_motion_event(&self, event: &MotionEvent) -> Result<()> {
        assert_eq!(event.x, 12.);
        self.state.events.borrow_mut().push("motion".into());
        Ok(())
    }
    fn on_focus_changed(&self, focused: bool, leaf: bool) -> Result<()> {
        assert!(focused && leaf);
        self.state.events.borrow_mut().push("focus".into());
        Ok(())
    }
    fn is_surface_enabled(&self) -> bool {
        true
    }
    fn surface_buffer_mode(&self) -> SurfaceBufferMode {
        SurfaceBufferMode::Triple
    }
    fn on_method_invoked(&self, method: Method, params: &Value) -> Result<Reply> {
        match method {
            Method::Write => Ok(Reply::success(Value::text(
                &params.get(Property::Text)?.string()?,
            )?)),
            Method::Focus => {
                // Simulate a reentrant UI action which drops the host reference.
                unsafe {
                    ffi::lynx_native_view_release(self.handle.as_ptr()?.as_ptr());
                }
                assert_eq!(self.state.drops.get(), 0);
                Ok(Reply::success(Value::boolean(true)?))
            }
            Method::Key => panic!("probe callback"),
            Method::RenderFrame => Err(anyhow::anyhow!("inner failure")).context("outer failure"),
            _ => Ok(Reply::method_not_found()),
        }
    }
}
impl ViewFactory for Probe {
    type Context = Rc<ProbeState>;
    fn create(handle: Handle, _target: Target<Self>, context: &Self::Context) -> Result<Self> {
        Ok(Self {
            state: context.clone(),
            handle,
        })
    }
}
impl Drop for Probe {
    fn drop(&mut self) {
        self.state.drops.set(self.state.drops.get() + 1);
    }
}
fn probe(state: Rc<ProbeState>) -> (View, Handle, Target<Probe>) {
    let mut saved = None;
    let view = View::new(|handle: Handle, target: Target<Probe>| {
        saved = Some((handle.clone(), target.clone()));
        Ok(Probe { state, handle })
    })
    .unwrap();
    let (handle, target) = saved.unwrap();
    (view, handle, target)
}
unsafe fn invoke(raw: *mut RawView, method: &CStr, params: Value) {
    let (callbacks, data) = unsafe { host::callbacks(raw) };
    let params = params.into_raw();
    unsafe {
        callbacks.invoke.unwrap()(
            raw,
            data,
            method.as_ptr(),
            params,
            Some(host::reply),
            ffi::lynx_native_view_callback_info_t {
                impl_: std::ptr::null_mut(),
                callback_id: 42,
            },
        );
        ffi::lynx_value_remove_reference(std::ptr::null_mut(), params, std::ptr::null_mut());
    }
}

#[test]
fn installed_callbacks_preserve_arguments_and_release_only_on_final_unref() {
    let state = Rc::new(ProbeState::default());
    let (view, handle, target) = probe(state.clone());
    let raw = view.into_raw();
    unsafe {
        let (callbacks, data) = host::callbacks(raw);
        assert!(callbacks.create.unwrap()(raw, data));
        assert!(!callbacks.scroll.unwrap()(raw, data));
        assert!(callbacks.surface.unwrap()(raw, data));
        assert_eq!(
            SurfaceBufferMode::from(callbacks.buffer.unwrap()(raw, data)),
            SurfaceBufferMode::Triple
        );
        callbacks.attach.unwrap()(raw, data);
        callbacks.layout.unwrap()(raw, data, 1., 2., 200., 100., 2.);
        let attrs = Value::map().unwrap();
        attrs
            .set(Property::Text, &Value::text("props").unwrap())
            .unwrap();
        let attrs = attrs.into_raw();
        let events = Value::null().into_raw();
        callbacks.properties.unwrap()(raw, data, attrs, events);
        ffi::lynx_value_remove_reference(std::ptr::null_mut(), attrs, std::ptr::null_mut());
        let mut event: ffi::native_view_motion_event_t = std::mem::zeroed();
        event.x = 12.;
        callbacks.motion.unwrap()(raw, data, &mut event);
        callbacks.focus.unwrap()(raw, data, true, true);
        callbacks.detach.unwrap()(raw, data);
        callbacks.destroy.unwrap()(raw, data);
        assert_eq!(state.drops.get(), 0);
        ffi::lynx_native_view_retain(raw);
        ffi::lynx_native_view_release(raw);
        assert_eq!(state.drops.get(), 0);
        ffi::lynx_native_view_release(raw);
    }
    assert_eq!(
        *state.events.borrow(),
        [
            "attach", "layout", "props", "motion", "focus", "detach", "destroy"
        ]
    );
    assert_eq!(state.drops.get(), 1);
    assert!(handle.request_focus().is_err());
    target
        .dispatch(|_| panic!("released target must be skipped"))
        .unwrap();
    assert_eq!(host::LIVE_VIEWS.get(), 0);
    assert_eq!(values::LIVE_VALUES.get(), 0);
}

#[test]
fn invoke_transfers_values_reports_full_errors_and_contains_panics() {
    let (view, handle, _) = probe(Rc::default());
    let raw = handle.as_ptr().unwrap().as_ptr();
    let params = Value::map().unwrap();
    params
        .set(Property::Text, &Value::text("Hello 中\0文").unwrap())
        .unwrap();
    unsafe {
        invoke(raw, c"write", params);
        invoke(raw, c"unknown", Value::null());
        invoke(raw, c"renderFrame", Value::null());
        invoke(raw, c"key", Value::null());
    }
    host::REPLIES.with(|replies| {
        let replies = std::mem::take(&mut *replies.borrow_mut());
        assert_eq!(replies.len(), 4);
        assert_eq!(replies[0].0, 0);
        assert_eq!(replies[0].1.string().unwrap(), "Hello 中\0文");
        assert_eq!(replies[1].0, 3);
        assert!(replies[1].1.is_null());
        assert_eq!(replies[2].0, 7);
        assert!(
            replies[2]
                .1
                .string()
                .unwrap()
                .contains("outer failure: inner failure")
        );
        assert_eq!(replies[3].0, 7);
        assert!(replies[3].1.string().unwrap().contains("panicked"));
    });
    drop(view);
    assert_eq!(values::LIVE_VALUES.get(), 0);
}

#[test]
fn callback_and_frame_tokens_retain_across_reentrant_release_and_reject_other_threads() {
    let state = Rc::new(ProbeState::default());
    let (view, handle, target) = probe(state.clone());
    let other_thread = target.clone();
    assert!(
        std::thread::spawn(move || other_thread.dispatch(|_| panic!("wrong thread")))
            .join()
            .unwrap()
            .is_err()
    );
    let raw = view.into_raw();
    target
        .dispatch(|probe| {
            unsafe {
                ffi::lynx_native_view_release(raw);
            }
            assert_eq!(probe.state.drops.get(), 0);
            probe
                .handle
                .trigger_event(Event::ScrollChange, Value::map()?)
        })
        .unwrap();
    assert_eq!(state.drops.get(), 1);
    assert!(handle.as_ptr().is_err());
    host::EVENTS.with(|events| {
        let events = std::mem::take(&mut *events.borrow_mut());
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].0, "scrollchange");
    });
    assert_eq!(values::LIVE_VALUES.get(), 0);

    let state = Rc::new(ProbeState::default());
    let (view, handle, _) = probe(state.clone());
    unsafe {
        invoke(view.into_raw(), c"focus", Value::null());
    }
    assert_eq!(state.drops.get(), 1);
    assert!(handle.as_ptr().is_err());
    host::REPLIES.with(|replies| {
        let replies = std::mem::take(&mut *replies.borrow_mut());
        assert_eq!(replies.len(), 1);
        assert_eq!(replies[0].0, 0);
        assert!(replies[0].1.bool());
    });
}

#[test]
fn creation_failures_and_default_implementation_do_not_leak() {
    struct Empty;
    impl NativeView for Empty {}
    host::FAIL_CREATE.set(true);
    assert!(View::new(|_, _: Target<Empty>| Ok(Empty)).is_err());
    assert!(View::new(|_, _: Target<Empty>| anyhow::bail!("init failure")).is_err());
    assert!(guard(|| View::new(|_, _: Target<Empty>| panic!("init panic"))).is_err());
    assert_eq!(host::LIVE_VIEWS.get(), 0);
    let view = View::new(|_, _: Target<Empty>| Ok(Empty)).unwrap();
    unsafe {
        let (callbacks, data) = host::callbacks(view.raw.as_ptr());
        assert!(!callbacks.surface.unwrap()(view.raw.as_ptr(), data));
        assert_eq!(
            SurfaceBufferMode::from(callbacks.buffer.unwrap()(view.raw.as_ptr(), data)),
            SurfaceBufferMode::Double
        );
        callbacks.attach.unwrap()(view.raw.as_ptr(), data);
        callbacks.destroy.unwrap()(view.raw.as_ptr(), data);
    }
    drop(view);
    assert_eq!(host::LIVE_VIEWS.get(), 0);
}

#[test]
fn generic_factory_registers_concrete_views_and_keeps_instances_isolated() {
    use crate::binding::extension::tests as extension_host;
    let first = Rc::new(ProbeState::default());
    let second = Rc::new(ProbeState::default());
    // The same component tag has a separate factory context in each window.
    let first_parent = NonNull::<LynxView>::dangling();
    let second_parent = NonNull::new(2usize as *mut LynxView).unwrap();
    unsafe {
        register::<Probe>(first_parent, ElementName::Terminal, &first);
        register::<Probe>(second_parent, ElementName::Terminal, &second);
    }
    let registrations = extension_host::take_native_registrations();
    assert_eq!(registrations[0].name, "native-terminal");
    assert_eq!(registrations[1].name, "native-terminal");
    assert_eq!(registrations[0].view, first_parent.as_ptr() as usize);
    assert_eq!(registrations[1].view, second_parent.as_ptr() as usize);
    let mut views = Vec::new();
    for registration in registrations {
        let raw = unsafe { registration.creator.unwrap()(registration.opaque as *mut _) };
        assert!(!raw.is_null());
        unsafe {
            let (callbacks, data) = host::callbacks(raw);
            callbacks.attach.unwrap()(raw, data);
        }
        views.push(raw);
    }
    unsafe {
        ffi::lynx_native_view_release(views[0]);
    }
    assert_eq!(first.drops.get(), 1);
    assert_eq!(second.drops.get(), 0);
    unsafe {
        ffi::lynx_native_view_release(views[1]);
    }
    assert_eq!(second.drops.get(), 1);
}

#[test]
fn value_properties_retain_independently_and_validate_numeric_ids() {
    let map = Value::map().unwrap();
    map.set(Property::Text, &Value::text("retained").unwrap())
        .unwrap();
    let text = map.get(Property::Text).unwrap();
    assert_eq!(values::LIVE_VALUES.get(), 2);
    drop(map);
    assert_eq!(values::LIVE_VALUES.get(), 1);
    assert_eq!(text.string().unwrap(), "retained");
    drop(text);
    assert_eq!(values::LIVE_VALUES.get(), 0);
    assert_eq!(
        Value::integer(u32::MAX.into()).unwrap().u32().unwrap(),
        u32::MAX
    );
    assert!(Value::integer(-1).unwrap().u32().is_err());
    assert!(
        Value::integer(i64::from(u32::MAX) + 1)
            .unwrap()
            .u32()
            .is_err()
    );
    assert!(Value::text("1").unwrap().u32().is_err());
    for number in [f64::NAN, f64::INFINITY, 1.5] {
        let mut raw: ffi::lynx_value = unsafe { std::mem::zeroed() };
        raw.type_ = ffi::lynx_value_double;
        raw.__bindgen_anon_1.val_double = number;
        assert!(unsafe { Value::borrow(raw) }.unwrap().u32().is_err());
    }
}
