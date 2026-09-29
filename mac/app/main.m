#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface RhineApp : NSObject <NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate>
@property NSWindow *window;
@property WKWebView *web;
@property NSTask *server;
@property NSInteger attempts;
@property BOOL launched;
@end
@implementation RhineApp
- (NSString *)project { return [NSBundle.mainBundle objectForInfoDictionaryKey:@"RhineProjectPath"]; }
- (NSURL *)home { return [NSURL URLWithString:@"http://127.0.0.1:5191/?mac=1"]; }
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    [self menus];
    WKWebViewConfiguration *config = [WKWebViewConfiguration new];
    config.websiteDataStore = WKWebsiteDataStore.defaultDataStore;
    config.mediaTypesRequiringUserActionForPlayback = WKAudiovisualMediaTypeNone;
    config.preferences.elementFullscreenEnabled = YES;
    self.web = [[WKWebView alloc] initWithFrame:NSMakeRect(0,0,1280,800) configuration:config];
    self.web.autoresizingMask=NSViewWidthSizable|NSViewHeightSizable;
    self.web.navigationDelegate=self; self.web.UIDelegate=self;
    self.web.allowsBackForwardNavigationGestures=NO;
    self.window=[[NSWindow alloc] initWithContentRect:NSMakeRect(0,0,1280,800) styleMask:NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable|NSWindowStyleMaskResizable backing:NSBackingStoreBuffered defer:NO];
    self.window.title=@"莱茵生命终端"; self.window.minSize=NSMakeSize(800,560);
    self.window.collectionBehavior=NSWindowCollectionBehaviorFullScreenPrimary;
    self.window.releasedWhenClosed=NO; self.window.contentView=self.web;
    [self.window center]; [self.window setFrameAutosaveName:@"RhineMainWindow"];
    [self.window makeKeyAndOrderFront:nil]; [NSApp activateIgnoringOtherApps:YES]; [self start:nil];
}
- (NSMenu *)menu:(NSString *)title bar:(NSMenu *)bar {
    NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:title action:NULL keyEquivalent:@""];
    item.submenu=[[NSMenu alloc] initWithTitle:title]; [bar addItem:item]; return item.submenu;
}
- (void)add:(NSMenu *)menu title:(NSString *)title action:(SEL)selector key:(NSString *)key flags:(NSEventModifierFlags)flags target:(id)target {
    NSMenuItem *item=[[NSMenuItem alloc] initWithTitle:title action:selector keyEquivalent:key]; item.target=target; item.keyEquivalentModifierMask=flags; [menu addItem:item];
}
- (void)menus {
    NSMenu *bar=[NSMenu new], *app=[self menu:@"莱茵生命" bar:bar];
    [self add:app title:@"关于莱茵生命终端" action:@selector(about:) key:@"" flags:0 target:self];
    [app addItem:NSMenuItem.separatorItem];
    [self add:app title:@"隐藏莱茵生命终端" action:@selector(hide:) key:@"h" flags:NSEventModifierFlagCommand target:NSApp];
    [self add:app title:@"退出莱茵生命终端" action:@selector(terminate:) key:@"q" flags:NSEventModifierFlagCommand target:NSApp];
    NSMenu *edit=[self menu:@"编辑" bar:bar];
    NSArray *titles=@[@"撤销",@"剪切",@"复制",@"粘贴",@"全选"];
    NSArray *selectors=@[@"undo:",@"cut:",@"copy:",@"paste:",@"selectAll:"];
    NSArray *keys=@[@"z",@"x",@"c",@"v",@"a"];
    for(NSUInteger i=0;i<titles.count;i++) [self add:edit title:titles[i] action:NSSelectorFromString(selectors[i]) key:keys[i] flags:NSEventModifierFlagCommand target:nil];
    [self add:edit title:@"重做" action:NSSelectorFromString(@"redo:") key:@"z" flags:NSEventModifierFlagCommand|NSEventModifierFlagShift target:nil];
    NSMenu *view=[self menu:@"显示" bar:bar];
    [self add:view title:@"进入／退出全屏" action:@selector(fullscreen:) key:@"f" flags:NSEventModifierFlagCommand|NSEventModifierFlagControl target:self];
    [self add:view title:@"重新载入终端" action:@selector(reload:) key:@"r" flags:NSEventModifierFlagCommand|NSEventModifierFlagShift target:self];
    [self add:view title:@"返回终端首页" action:@selector(start:) key:@"" flags:0 target:self];
    NSMenu *windows=[self menu:@"窗口" bar:bar];
    [self add:windows title:@"最小化" action:@selector(performMiniaturize:) key:@"m" flags:NSEventModifierFlagCommand target:nil];
    [self add:windows title:@"关闭窗口" action:@selector(performClose:) key:@"w" flags:NSEventModifierFlagCommand target:nil];
    NSApp.windowsMenu=windows; NSApp.mainMenu=bar;
}
- (void)about:(id)sender {
    NSAlert *alert=[NSAlert new]; alert.messageText=@"莱茵生命终端 · Mac";
    alert.informativeText=[NSString stringWithFormat:@"原生窗口 + 系统 WebKit，使用本机莱茵项目。\n全屏：⌃⌘F；重新载入：⇧⌘R。\n设置在本应用独立保存；秘书与光伏仍连接原有服务。\n本地项目：%@",self.project];
    [alert beginSheetModalForWindow:self.window completionHandler:nil];
}
- (void)fullscreen:(id)sender { [self.window toggleFullScreen:nil]; }
- (void)reload:(id)sender { [self.web reload]; }
- (void)start:(id)sender {
    self.attempts=0; self.launched=NO;
    [self.web loadHTMLString:@"<html><meta charset='utf-8'><body style='background:#eeece6;font:20px system-ui;padding:10%'><h1>RHINE LAB</h1><p>正在连接本机终端…</p></body></html>" baseURL:nil];
    [self connect];
}
- (void)connect {
    NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"http://127.0.0.1:5191/__rhine_health"]]; request.timeoutInterval=1;
    [[NSURLSession.sharedSession dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if([response isKindOfClass:NSHTTPURLResponse.class]) {
                NSDictionary *value=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
                if(((NSHTTPURLResponse *)response).statusCode!=200 || ![value isKindOfClass:NSDictionary.class] || ![value[@"app"] isEqual:@"rhine-mac-local"]) { [self failure:@"5191端口已有其他服务，未尝试替换它。"]; return; }
                [self.web loadRequest:[NSURLRequest requestWithURL:self.home]]; return;
            }
            if(!self.launched) { self.launched=YES; if(![self launchServer]) return; }
            if(++self.attempts>24) { [self failure:@"连接超时。请检查项目目录与 mac/logs/server.log，再从“显示”菜单返回首页。"]; return; }
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW,250*NSEC_PER_MSEC),dispatch_get_main_queue(),^{[self connect];});
        });
    }] resume];
}
- (BOOL)launchServer {
    NSTask *task=[NSTask new];
    task.executableURL=[NSURL fileURLWithPath:[self.project stringByAppendingPathComponent:@".runtime/node-v22.22.0-darwin-arm64/bin/node"]];
    task.arguments=@[[self.project stringByAppendingPathComponent:@"mac/server.mjs"]]; task.currentDirectoryURL=[NSURL fileURLWithPath:self.project];
    NSString *log=[self.project stringByAppendingPathComponent:@"mac/logs/server.log"];
    [NSFileManager.defaultManager createDirectoryAtPath:log.stringByDeletingLastPathComponent withIntermediateDirectories:YES attributes:nil error:nil];
    if(![NSFileManager.defaultManager fileExistsAtPath:log]) [NSFileManager.defaultManager createFileAtPath:log contents:nil attributes:nil];
    NSFileHandle *handle=[NSFileHandle fileHandleForWritingAtPath:log]; [handle seekToEndOfFile];
    task.standardOutput=handle; task.standardError=handle; task.standardInput=NSFileHandle.fileHandleWithNullDevice;
    NSError *error=nil; if(![task launchAndReturnError:&error]) { [self failure:[@"本地服务未能启动：" stringByAppendingString:error.localizedDescription]]; return NO; }
    self.server=task;
    [[NSString stringWithFormat:@"%d\n",task.processIdentifier] writeToFile:[self.project stringByAppendingPathComponent:@"mac/server.pid"] atomically:YES encoding:NSUTF8StringEncoding error:nil]; return YES;
}
- (void)failure:(NSString *)message { NSAlert *alert=[NSAlert new]; alert.messageText=@"终端暂时无法打开"; alert.informativeText=message; [alert beginSheetModalForWindow:self.window completionHandler:nil]; }
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)visible { [self.window makeKeyAndOrderFront:nil]; return YES; }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }
- (BOOL)local:(NSURL *)url { return [url.scheme isEqual:@"http"] && [url.host isEqual:@"127.0.0.1"] && url.port.integerValue==5191; }
- (void)external:(NSURL *)url { if([@[@"https",@"http",@"mailto"] containsObject:url.scheme]) [NSWorkspace.sharedWorkspace openURL:url]; }
- (void)webView:(WKWebView *)view decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler {
    NSURL *url=action.request.URL;
    if(action.targetFrame && !action.targetFrame.mainFrame) { handler(WKNavigationActionPolicyAllow); return; }
    if([url.absoluteString isEqual:@"about:blank"] || [self local:url] || [url.scheme isEqual:@"blob"]) handler(action.shouldPerformDownload?WKNavigationActionPolicyDownload:WKNavigationActionPolicyAllow);
    else { if(action.navigationType==WKNavigationTypeLinkActivated || !action.targetFrame) [self external:url]; handler(WKNavigationActionPolicyCancel); }
}
- (WKWebView *)webView:(WKWebView *)view createWebViewWithConfiguration:(WKWebViewConfiguration *)config forNavigationAction:(WKNavigationAction *)action windowFeatures:(WKWindowFeatures *)features {
    if([self local:action.request.URL]) [view loadRequest:action.request]; else [self external:action.request.URL]; return nil;
}
- (void)webView:(WKWebView *)view decidePolicyForNavigationResponse:(WKNavigationResponse *)response decisionHandler:(void (^)(WKNavigationResponsePolicy))handler { handler(response.canShowMIMEType?WKNavigationResponsePolicyAllow:WKNavigationResponsePolicyDownload); }
- (void)webView:(WKWebView *)view navigationAction:(WKNavigationAction *)action didBecomeDownload:(WKDownload *)download { download.delegate=self; }
- (void)webView:(WKWebView *)view navigationResponse:(WKNavigationResponse *)response didBecomeDownload:(WKDownload *)download { download.delegate=self; }
- (void)download:(WKDownload *)download decideDestinationUsingResponse:(NSURLResponse *)response suggestedFilename:(NSString *)filename completionHandler:(void (^)(NSURL *))handler {
    NSSavePanel *panel=[NSSavePanel savePanel]; panel.nameFieldStringValue=filename;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler(result==NSModalResponseOK?panel.URL:nil);}];
}
- (void)webView:(WKWebView *)view runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(NSArray<NSURL *> *))handler {
    NSOpenPanel *panel=[NSOpenPanel openPanel]; panel.allowsMultipleSelection=parameters.allowsMultipleSelection; panel.canChooseDirectories=parameters.allowsDirectories;
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler(result==NSModalResponseOK?panel.URLs:nil);}];
}
- (void)webView:(WKWebView *)view runJavaScriptAlertPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(void))handler {
    NSAlert *alert=[NSAlert new]; alert.messageText=message; [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler();}];
}
- (void)webView:(WKWebView *)view runJavaScriptConfirmPanelWithMessage:(NSString *)message initiatedByFrame:(WKFrameInfo *)frame completionHandler:(void (^)(BOOL))handler {
    NSAlert *alert=[NSAlert new]; alert.messageText=message; [alert addButtonWithTitle:@"确定"]; [alert addButtonWithTitle:@"取消"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result){handler(result==NSAlertFirstButtonReturn);}];
}
- (void)webView:(WKWebView *)view didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error { if(error.code!=NSURLErrorCancelled) [self failure:error.localizedDescription]; }
- (void)webViewWebContentProcessDidTerminate:(WKWebView *)view { [self failure:@"网页渲染进程退出，可按 ⇧⌘R 重新载入。"]; }
@end
int main(int argc, const char *argv[]) {
    @autoreleasepool { NSApplication *app=NSApplication.sharedApplication; RhineApp *delegate=[RhineApp new]; app.delegate=delegate; [app setActivationPolicy:NSApplicationActivationPolicyRegular]; [app run]; }
    return 0;
}
