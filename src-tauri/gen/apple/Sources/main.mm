// The Tauri mobile entry point installs UIKit's application delegate.
extern "C" void start_app();

int main(int argc, char *argv[]) {
    start_app();
    return 0;
}
