#define _POSIX_C_SOURCE 200809L
#define _DEFAULT_SOURCE
#define _DARWIN_C_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

enum { LOG_LIMIT = 1024 * 1024, RETAIN = 256 * 1024, CHUNK = 8192 };

static int write_all(int fd, const char *data, size_t length)
{
    while (length > 0) {
        ssize_t written = write(fd, data, length);
        if (written < 0 && errno == EINTR)
            continue;
        if (written <= 0)
            return -1;
        data += written;
        length -= written;
    }
    return 0;
}

static int keep_recent(int fd, off_t size)
{
    static char tail[RETAIN];
    size_t length = 0;

    while (length < sizeof(tail)) {
        ssize_t n = pread(fd, tail + length, sizeof(tail) - length,
                          size - (off_t)sizeof(tail) + (off_t)length);
        if (n < 0 && errno == EINTR)
            continue;
        if (n < 0)
            return -1;
        if (n == 0)
            break;
        length += n;
    }

    // The first line can start before the retained window.
    char *newline = memchr(tail, '\n', length);
    size_t skip = newline ? (size_t)(newline + 1 - tail) : 0;
    if (ftruncate(fd, 0) < 0)
        return -1;
    return write_all(fd, tail + skip, length - skip);
}

static int update(int fd, const char *data, size_t length, int clear)
{
    if (fd < 0)
        return -1;

    int result;
    do {
        result = flock(fd, LOCK_EX);
    } while (result < 0 && errno == EINTR);
    if (result < 0)
        return -1;

    struct stat file;
    if (clear) {
        result = ftruncate(fd, 0);
    } else {
        result = fstat(fd, &file);
        if (result == 0 && file.st_size > LOG_LIMIT - (off_t)length)
            result = keep_recent(fd, file.st_size);
        if (result == 0)
            result = write_all(fd, data, length);
    }

    int saved = errno;
    flock(fd, LOCK_UN);
    errno = saved;
    return result;
}

static int capture(const char *path, int input)
{
    char data[CHUNK];
    int fd = open(path, O_RDWR | O_APPEND | O_CREAT | O_NOFOLLOW, 0600);
    int warned = fd < 0;
    ssize_t length = 0;
    if (warned)
        perror(path);

    // Also shrink an oversized file left by an older package, even with no input.
    do {
        if (fd >= 0 && update(fd, data, length, 0) < 0 && !warned) {
            warned = 1;
            perror(path);
        }
        do {
            length = read(input, data, sizeof(data));
        } while (length < 0 && errno == EINTR);
    } while (length > 0);

    if (fd >= 0)
        close(fd);
    return length < 0 ? 1 : 0;
}

int main(int argc, char **argv)
{
    if (argc == 3 && strcmp(argv[1], "--clear") == 0) {
        int fd = open(argv[2], O_RDWR | O_CREAT | O_NOFOLLOW, 0600);
        if (update(fd, NULL, 0, 1) == 0)
            return 0;
        perror(argv[2]);
        return 1;
    }
    if (argc == 2)
        return capture(argv[1], STDIN_FILENO);
    if (argc < 2) {
        fprintf(stderr, "usage: nikkic-log LOG [COMMAND ...] | --clear LOG\n");
        return 2;
    }

    int channel[2];
    if (pipe(channel) == 0) {
        pid_t reader = fork();
        if (reader == 0) {
            close(channel[1]);
            _exit(capture(argv[1], channel[0]));
        }
        if (reader > 0) {
            // procd keeps tracking this PID and delivers signals directly to Concord.
            close(channel[0]);
            if (dup2(channel[1], STDOUT_FILENO) >= 0 && dup2(channel[1], STDERR_FILENO) >= 0) {
                close(channel[1]);
                execvp(argv[2], argv + 2);
            }
        }
    }
    perror("nikkic-log");
    return 1;
}
