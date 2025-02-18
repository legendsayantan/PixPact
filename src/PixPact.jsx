import React, { useState, useRef } from 'react';
import './PixPact.css';
import { jsPDF } from 'jspdf';
import empty_preview_image from "./images/icon.svg"

// All dimensions in mm for paper sizes
const paperSizes = {
    A1: { width: 594, height: 841 },
    A3: { width: 297, height: 420 },
    A4: { width: 210, height: 297 },
    A5: { width: 148, height: 210 },
    Letter: { width: 215.9, height: 279.4 },
    Legal: { width: 215.9, height: 355.6 },
    Tabloid: { width: 279.4, height: 431.8 }
};

const round2 = (n) => Math.round(n * 100) / 100;

// Convert an image source to a DataURL using a canvas
const getImageDataUrl = (imgSrc) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";
        img.onload = function() {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            // Disable image smoothing to avoid unwanted artifacts.
            ctx.imageSmoothingEnabled = false;
            // Fill with white
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            // Draw the image (using source-over).
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(img, 0, 0);
            // Export as JPEG to avoid alpha issues.
            const dataURL = canvas.toDataURL('image/jpeg', 1.0);
            resolve(dataURL);
        };
        img.onerror = reject;
        img.src = imgSrc;
    });
};

const PixPact = () => {
    const [images, setImages] = useState([]);
    const [globalScale, setGlobalScale] = useState(50);
    const [scaleOption, setScaleOption] = useState("columns");
    const [columnsPerPage, setColumnsPerPage] = useState(2);
    const [pageFormat, setPageFormat] = useState("A4");
    const [orientation, setOrientation] = useState("portrait");
    const [customPageWidth, setCustomPageWidth] = useState('');
    const [customPageHeight, setCustomPageHeight] = useState('');
    const [pageBorder, setPageBorder] = useState(0);
    const [imageMargin, setImageMargin] = useState(0);
    const [priority, setPriority] = useState("pages");
    const [popupImageIndex, setPopupImageIndex] = useState(null);
    const [calcPages, setCalcPages] = useState(null);
    const [showCalcPopup, setShowCalcPopup] = useState(false);
    const [activeCalcPage, setActiveCalcPage] = useState(0);
    const [pdfLoading, setPdfLoading] = useState(false);
    const fileInputRef = useRef(null);

    // Handle image selection
    const handleFiles = (e) => {
        const files = Array.from(e.target.files);
        files.forEach((file) => {
            const src = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                setImages((prev) => [
                    ...prev,
                    {
                        file,
                        src,
                        width: img.width,
                        height: img.height,
                        overrideScale: '',
                    },
                ]);
            };
            img.src = src;
        });
    };

    const openPopup = (index) => {
        setPopupImageIndex(index);
    };

    const closePopup = (shouldMove=true) => {
        let modifiedNo = document.getElementById("imageNoModified");
        if(shouldMove && modifiedNo.value!==modifiedNo.defaultValue) {
            moveItemTo(popupImageIndex, parseInt(modifiedNo.value, 10) - 1);
        }
        setPopupImageIndex(null);
    };

    const moveItemTo = (index, destinationIndex) => {
        setImages(prevImages => {
            // create a shallow copy of the array
            const updatedImages = [...prevImages];
            // remove the image at 'index'
            const [movedImage] = updatedImages.splice(index, 1);
            // insert the image at 'destinationIndex'
            updatedImages.splice(destinationIndex, 0, movedImage);
            return updatedImages;
        });
    };

    const handleOverrideChange = (index, value) => {
        setImages((prev) =>
            prev.map((img, idx) =>
                idx === index ? { ...img, overrideScale: value } : img
            )
        );
    };

    const removeImage = (index) => {
        setImages((prev) => prev.filter((img, idx) => idx !== index));
    };

    // Updated calculation algorithm using column-based packing.
    const calculateLayout = () => {
        let pageWidth, pageHeight;
        if (pageFormat === "Custom") {
            pageWidth = parseFloat(customPageWidth);
            pageHeight = parseFloat(customPageHeight);
        } else {
            const dims = paperSizes[pageFormat];
            pageWidth = dims.width;
            pageHeight = dims.height;
        }
        if (orientation === "landscape") {
            [pageWidth, pageHeight] = [pageHeight, pageWidth];
        }
        const margin = parseFloat(imageMargin) || 0;
        const borderValue = parseFloat(pageBorder) || 0;

        // Define the available area inside the border.
        const availableWidth = pageWidth - 2 * borderValue;
        const availableHeight = pageHeight - 2 * borderValue;

        // Compute scaled dimensions for each image.
        const scaledImages = images.map((img, idx) => {
            const override = img.overrideScale ? parseFloat(img.overrideScale) : null;
            if (override !== null && !isNaN(override)) {
                return {
                    index: idx,
                    width: img.width * (override / 100),
                    height: img.height * (override / 100),
                    src: img.src
                };
            } else if (scaleOption === "percentage") {
                return {
                    index: idx,
                    width: img.width * (globalScale / 100),
                    height: img.height * (globalScale / 100),
                    src: img.src
                };
            } else {
                // Fixed columns mode: use availableWidth (accounting for border)
                const effectivePageWidth = availableWidth - ((columnsPerPage - 1) * margin);
                let columnWidth = Math.floor(effectivePageWidth / columnsPerPage);
                let scale = columnWidth / img.width;
                // if image is still taller than the available area, scale it down further
                if ((img.height * scale) > availableHeight) {
                    scale = availableHeight / img.height;
                    columnWidth = Math.floor(img.width * scale);
                }
                return {
                    index: idx,
                    width: columnWidth,
                    height: Math.floor(img.height * scale),
                    src: img.src
                };
            }
        });

        // Check if any image is too big for the available area (ignoring margins).
        const tooBig = scaledImages.find(
            (img) => img.width > availableWidth || img.height > availableHeight
        );
        if (tooBig) {
            alert(
                "Image " +
                (tooBig.index + 1) +
                " is too big for the page. Please reduce scale."
            );
            return [];
        }

        // Optional: sort images (here, descending by area).
        if(priority==="pages"){
            scaledImages.sort(
                (a, b) => b.width * b.height - a.width * a.height
            );
        }

        // Initialize the skyline to the top edge of the available area.
        // The x coordinate starts at borderValue and spans availableWidth.
        let skyline = [{ x: borderValue, width: availableWidth, y: borderValue }];

        // Find a placement for an image in the current skyline.
        const findPositionForImage = (img) => {
            let bestY = Infinity;
            let bestX = 0;
            let bestNodeIndex = -1;
            for (let i = 0; i < skyline.length; i++) {
                const node = skyline[i];
                if (node.width >= img.width) {
                    // Choose the node with the smallest y (i.e. highest available position)
                    if (node.y < bestY || (node.y === bestY && node.x < bestX)) {
                        bestY = node.y;
                        bestX = node.x;
                        bestNodeIndex = i;
                    }
                }
            }
            // Ensure the image fits vertically in the available area.
            if (
                bestNodeIndex === -1 ||
                bestY + img.height > borderValue + availableHeight
            ) {
                return null;
            }
            return { x: bestX, y: bestY, nodeIndex: bestNodeIndex };
        };

        // Update the skyline after placing an image.
        // Here we ensure that the right segment begins at (pos.x + img.width + margin)
        // if the existing node starts at or before pos.x + img.width.
        const updateSkyline = (pos, img) => {
            const newNode = {
                x: pos.x,
                width: img.width,
                y: pos.y + img.height + margin
            };

            let newSkyline = [];
            for (let node of skyline) {
                // If node is completely to the left of the placed image.
                if (node.x + node.width <= pos.x) {
                    newSkyline.push(node);
                }
                // If node is completely to the right of the placed image.
                else if (node.x >= pos.x + img.width) {
                    // If the node is exactly adjacent to the placed image, shift it.
                    if (node.x === pos.x + img.width) {
                        newSkyline.push({
                            x: node.x + margin,
                            width: node.width,
                            y: node.y
                        });
                    } else {
                        newSkyline.push(node);
                    }
                }
                // Node overlaps with the placed image.
                else {
                    // Left segment, if any.
                    if (node.x < pos.x) {
                        newSkyline.push({
                            x: node.x,
                            width: pos.x - node.x,
                            y: node.y
                        });
                    }
                    // Right segment: We want it to start at pos.x + img.width + margin.
                    let rightEdge = node.x + node.width;
                    let desiredX = pos.x + img.width + margin;
                    if (rightEdge > desiredX) {
                        newSkyline.push({
                            x: desiredX,
                            width: rightEdge - desiredX,
                            y: node.y
                        });
                    }
                }
            }
            newSkyline.push(newNode);

            // Merge adjacent nodes with the same y.
            newSkyline.sort((a, b) => a.x - b.x);
            let merged = [];
            for (let node of newSkyline) {
                if (merged.length > 0) {
                    let last = merged[merged.length - 1];
                    if (last.y === node.y && last.x + last.width >= node.x) {
                        last.width = Math.max(last.width, node.x + node.width - last.x);
                        continue;
                    }
                }
                merged.push(node);
            }
            skyline = merged;
        };

        const pages = [];
        let remaining = [...scaledImages];

        // Pack images into pages using the skyline algorithm.
        while (remaining.length > 0) {
            // Reset the skyline for a new page (starting at the border).
            skyline = [{ x: borderValue, width: availableWidth, y: borderValue }];
            let pagePlacements = [];
            const newRemaining = [];
            let filledFlag = false;
            for (let img of remaining) {
                if(filledFlag){
                    newRemaining.push(img);
                    continue;
                }
                let pos = findPositionForImage(img);
                if (pos) {
                    pagePlacements.push({
                        index: img.index,
                        x: pos.x,
                        y: pos.y,
                        width: img.width,
                        height: img.height,
                        src: img.src
                    });
                    updateSkyline(pos, img);
                } else {
                    // Defer the image to the next page.
                    if(priority==="order"){
                        filledFlag = true;
                    }
                    newRemaining.push(img);
                }
            }
            pages.push(pagePlacements);
            if (pagePlacements.length === 0) break; // Avoid infinite loop.
            remaining = newRemaining;
        }
        return pages;
    };





    const handleCalculate = () => {
        const pages = calculateLayout();
        if (pages.length > 0) {
            setCalcPages(pages);
            setActiveCalcPage(0);
            setShowCalcPopup(true);
            console.log("Calculated layout:", pages);
        }
    };

    const handleGeneratePDF = async () => {
        setPdfLoading(true);
        let pageWidth, pageHeight;
        if (pageFormat === "Custom") {
            pageWidth = parseFloat(customPageWidth);
            pageHeight = parseFloat(customPageHeight);
        } else {
            const dims = paperSizes[pageFormat];
            pageWidth = dims.width;
            pageHeight = dims.height;
        }
        if (orientation === "landscape") {
            [pageWidth, pageHeight] = [pageHeight, pageWidth];
        }
        const pages = calculateLayout();
        if (pages.length === 0) {
            setPdfLoading(false);
            return;
        }
        const pdf = new jsPDF({
            orientation: orientation,
            unit: 'mm',
            format: [pageWidth, pageHeight]
        });
        for (let p = 0; p < pages.length; p++) {
            if (p > 0) pdf.addPage([pageWidth, pageHeight], orientation);
            for (let placement of pages[p]) {
                const dataUrl = await getImageDataUrl(images[placement.index].src);
                pdf.addImage(dataUrl, 'JPEG', placement.x, placement.y, placement.width, placement.height);
            }
        }
        pdf.save("pixpact_output ("+images.length+" images).pdf");
        setPdfLoading(false);
    };

    return (
        <div className="home-container">
            {pdfLoading && (
                <div className="loading-overlay">
                    <div className="loading-spinner">Creating PDF...</div>
                </div>
            )}
            <header className="header-container">
                <h1 className="header-title">PixPact</h1>
                <div className="header-links">
                    <a href="https://sayantan.is-a.dev" target="_blank" rel="noopener noreferrer">Developer</a>
                    <a href="https://github.com/legendsayantan/pixpact" target="_blank" rel="noopener noreferrer">Source Code</a>
                </div>
            </header>

            <div className="main-container">
                <div className="controls">
                    <div className="file-input-container">
                        <label htmlFor="fileInput" className="file-label">
                            Select Images
                        </label>
                        <input
                            id="fileInput"
                            type="file"
                            accept="image/*"
                            multiple
                            className="file-input"
                            onChange={handleFiles}
                            ref={fileInputRef}
                        />
                    </div>

                    <div className="page-customization">
                        <div className="form-group hrzntl">
                            <label>Page:</label>
                            <select
                                value={pageFormat}
                                onChange={(e) => setPageFormat(e.target.value)}
                                className="styled-select"
                            >
                                <option value="A4">A4</option>
                                <option value="Letter">Letter</option>
                                <option value="Legal">Legal</option>
                                <option value="A1">A1</option>
                                <option value="A3">A3</option>
                                <option value="A5">A5</option>
                                <option value="Tabloid">Tabloid</option>
                                <option value="Custom">Custom</option>
                            </select>
                        </div>
                        {pageFormat === "Custom" && (
                            <div className="form-group hrzntl">
                                <input
                                    type="number"
                                    placeholder="Width (mm)"
                                    value={customPageWidth}
                                    onChange={(e) => setCustomPageWidth(e.target.value)}
                                    className="styled-input"
                                />
                                <input
                                    type="number"
                                    placeholder="Height (mm)"
                                    value={customPageHeight}
                                    onChange={(e) => setCustomPageHeight(e.target.value)}
                                    className="styled-input"
                                />
                            </div>
                        )}
                        <div className="form-group">
                            <label>Orientation:</label>
                            <div className="orientation-options">
                                <label className="modern-radio">
                                    <input
                                        type="radio"
                                        value="portrait"
                                        checked={orientation === "portrait"}
                                        onChange={(e) => setOrientation(e.target.value)}
                                    />
                                    <span>Portrait</span>
                                </label>
                                <label className="modern-radio">
                                    <input
                                        type="radio"
                                        value="landscape"
                                        checked={orientation === "landscape"}
                                        onChange={(e) => setOrientation(e.target.value)}
                                    />
                                    <span>Landscape</span>
                                </label>
                            </div>
                        </div>

                    </div>

                    <div className="scale-customization">
                        <h3>Scale Customization</h3>
                        <div className="form-group">
                            <label className="modern-radio">
                                <input
                                    type="radio"
                                    value="percentage"
                                    checked={scaleOption === "percentage"}
                                    onChange={(e) => setScaleOption(e.target.value)}
                                />
                                <span>Resolution Scale</span>
                            </label>
                            <label className="modern-radio">
                                <input
                                    type="radio"
                                    value="columns"
                                    checked={scaleOption === "columns"}
                                    onChange={(e) => setScaleOption(e.target.value)}
                                />
                                <span>Columns per Page</span>
                            </label>
                        </div>
                        <div className="form-group">
                            {scaleOption === "percentage" ? (
                                <>
                                    <input
                                        type="number"
                                        step="1"
                                        value={globalScale}
                                        onChange={(e) => setGlobalScale(parseFloat(e.target.value))}
                                        className="styled-input"
                                    />
                                </>
                            ) : (
                                <>
                                    <input
                                        type="number"
                                        min="1"
                                        value={columnsPerPage}
                                        onChange={(e) => setColumnsPerPage(parseInt(e.target.value, 10))}
                                        className="styled-input"
                                    />
                                </>
                            )}
                        </div>
                    </div>

                    <div className="form-group hrzntl">
                        <label>Border:</label>
                        <input
                            type="number"
                            value={pageBorder}
                            onChange={(e) => setPageBorder(e.target.value)}
                            className="styled-input"
                        />
                    </div>
                    <div className="form-group hrzntl">
                        <label>Margin:</label>
                        <input
                            type="number"
                            value={imageMargin}
                            onChange={(e) => setImageMargin(e.target.value)}
                            className="styled-input"
                        />
                    </div>

                    <div className="form-group hrzntl">
                        <label>Priority:</label>
                        <select
                            value={priority}
                            onChange={(e) => setPriority(e.target.value)}
                            className="styled-select"
                        >
                            <option value="pages">Use least pages</option>
                            <option value="try">Try to maintain order</option>
                            <option value="order">Strictly maintain order</option>
                        </select>
                    </div>



                    <div className="control-btns">
                        <button onClick={handleCalculate} className="control-btn calc-btn">
                            Preview
                        </button>
                        <button onClick={handleGeneratePDF} className="control-btn generate-btn">
                            Save as PDF
                        </button>
                    </div>
                </div>

                {
                    images.length === 0 ? (
                        <div className="empty-preview">
                            <div>
                                <img src={empty_preview_image} alt="add" style={{width:"100px",height:"100px",color:"white"}}/>
                                <h2>Add some images to effortlessly compact them into pages</h2>
                                <p>Provide mismatching images, of any size, resolution or aspect ratio</p>
                            </div>
                            <p style={{alignSelf:"end",fontSize:"small"}}>Have feedback? <a href="https://github.com/legendsayantan/pixpact/issues">write them here</a></p>
                        </div>
                    ) : (
                        <div className="previews">
                            {images.map((img, index) => (
                                <div key={index} className="preview-container" onClick={() => openPopup(index)}>
                                    <div className="preview-number">{index + 1}</div>
                                    <img
                                        src={img.src}
                                        alt={`Preview ${index}`}
                                        className="preview-image"
                                    />
                                    <div className="overlay">
                <span>
                  {img.width} x {img.height}
                </span>
                                        <span>Scale: {img.overrideScale || (scaleOption==="columns" ? "Auto-fit" : "Default")}{img.overrideScale && "%"}</span>
                                    </div>
                                    <button
                                        className="remove-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            removeImage(index);
                                        }}
                                    >
                                        &times;
                                    </button>
                                </div>
                            ))}
                        </div>
                    )
                }

            </div>

            {/* Customise popup for individual image */}
            {popupImageIndex !== null && (
                <div className="popup-overlay" onClick={closePopup}>
                    <div className="popup" onClick={(e) => e.stopPropagation()}>
                        <div className="popup-content">
                            <div className="popup-image-container">
                                <img src={images[popupImageIndex].src} alt="Large Preview" />
                            </div>
                            <div className="popup-controls">
                                <h2>Customise</h2>
                                <p>
                                    Image dimensions: {images[popupImageIndex].width} x {images[popupImageIndex].height}
                                </p>
                                <div className="form-group hrzntl" style={{margin:0}}>
                                    <label style={{width:"100%"}}>Image No.</label>
                                    <input
                                        type="number"
                                        step="1"
                                        defaultValue={popupImageIndex+1}
                                        id="imageNoModified"
                                        className="popup-input styled-input"
                                    />
                                </div>
                                <div className="form-group hrzntl"style={{margin:0}}>
                                    <label style={{width:"100%"}}>Override Scale:</label>
                                    <input
                                        type="number"
                                        step="1"
                                        value={images[popupImageIndex].overrideScale}
                                        placeholder={scaleOption==="columns" ? "Auto-fit" : "Default"}
                                        onChange={(e) =>
                                            handleOverrideChange(popupImageIndex, e.target.value)
                                        }
                                        className="popup-input styled-input"
                                    />
                                </div>
                                <div className="popup-btn-group">
                                    <button
                                        onClick={() => {
                                            removeImage(popupImageIndex);
                                            closePopup(false);
                                        }}
                                        className="popup-btn"
                                    >
                                        Remove Image
                                    </button>
                                    <button onClick={closePopup} className="popup-btn">
                                        Close
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Calculate Layout Popup with vertical arrangement */}
            {showCalcPopup && calcPages && (
                <div className="popup-overlay" onClick={() => setShowCalcPopup(false)}>
                    <div className="popup calc-popup-vertical" onClick={(e) => e.stopPropagation()}>
                        <h2 className="calc-heading">Layout Preview</h2>
                        <div className="calc-tabs">
                            {calcPages.map((page, idx) => (
                                <button
                                    key={idx}
                                    className={`calc-tab ${activeCalcPage === idx ? "active" : ""}`}
                                    onClick={() => setActiveCalcPage(idx)}
                                >
                                    {idx + 1}
                                </button>
                            ))}
                        </div>
                        <div className="calc-preview-container-vertical">
                            {(() => {
                                let pageWidth, pageHeight;
                                if (pageFormat === "Custom") {
                                    pageWidth = parseFloat(customPageWidth) || 210;
                                    pageHeight = parseFloat(customPageHeight) || 297;
                                } else {
                                    const dims = paperSizes[pageFormat];
                                    pageWidth = dims.width;
                                    pageHeight = dims.height;
                                }
                                if (orientation === "landscape") {
                                    [pageWidth, pageHeight] = [pageHeight, pageWidth];
                                }
                                const widthScale = (window.innerWidth-100)/pageWidth;
                                const heightScale = (window.innerHeight-250)/pageHeight;
                                const scaleFactor = Math.min(widthScale, heightScale);
                                const previewWidth = pageWidth * scaleFactor;
                                const previewHeight = pageHeight * scaleFactor;
                                return (
                                    <div
                                        className="calc-preview-page"
                                        style={{ width: previewWidth, height: previewHeight }}
                                    >
                                        {calcPages[activeCalcPage].map(item => (
                                            <div
                                                key={item.index}
                                                style={{
                                                    position: 'absolute',
                                                    left: item.x * scaleFactor,
                                                    top: item.y * scaleFactor,
                                                    width: item.width * scaleFactor,
                                                    height: item.height * scaleFactor,
                                                    border: '2px dashed #FFD700', // deep yellow border
                                                    boxSizing: 'border-box'
                                                }}
                                            >
                                                <img
                                                    src={images[item.index].src}
                                                    alt={`Image ${item.index + 1}`}
                                                    style={{
                                                        width: '100%',
                                                        height: '100%',
                                                        display: 'block'
                                                    }}
                                                />
                                                <div
                                                    style={{
                                                        position: 'absolute',
                                                        top: 0,
                                                        left: 0,
                                                        background: '#ff5722', // or another color for contrast
                                                        color: '#fff',
                                                        padding: '2px 4px',
                                                        fontSize: '10px'
                                                    }}
                                                >
                                                    {item.index + 1}
                                                </div>
                                            </div>
                                        ))}

                                    </div>
                                );
                            })()}
                        </div>
                        <button onClick={() => setShowCalcPopup(false)} className="popup-btn">
                            Close
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PixPact;
