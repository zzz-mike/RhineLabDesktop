#import <Cocoa/Cocoa.h>
int main(void) {
  @autoreleasepool {
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [NSApp activateIgnoringOtherApps:YES];
    NSOpenPanel *panel=[NSOpenPanel openPanel];
    panel.canChooseFiles=NO;panel.canChooseDirectories=YES;panel.allowsMultipleSelection=NO;
    panel.prompt=@"允许读取此文件夹";
    panel.message=@"莱茵生命将读取所选目录的文件名、子目录，并在预览时读取内容。不会自动上传文件；关闭连接后停止读取。";
    if([panel runModal]!=NSModalResponseOK)return 2;
    const char *path=panel.URL.path.UTF8String;
    if(!path)return 1;
    printf("%s\n",path);return 0;
  }
}
