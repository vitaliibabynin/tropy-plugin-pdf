'use strict'

const { join, extname } = require('path')
const PDFDocument = require('pdfkit')
const { createWriteStream, copyFile } = require('fs')
const { shell } = require('electron')
const { promisify } = require('util')
const copyFileAsync = promisify(copyFile)

class PDFOriginalPlugin {
  constructor(options, context) {
    this.options = {
      ...PDFOriginalPlugin.defaults,
      ...options
    }

    this.logger = context.logger
    this.dialog = context.dialog.save
  }

  async generatePDF(data, outputPath) {
    // Check if we're dealing with PDF photos
    const firstPhoto = data['@graph'][0]?.photo?.[0]
    if (firstPhoto?.mimetype === 'application/pdf') {
      // For PDF files, copy the first photo's PDF file
      // This will be the original PDF that was imported
      await copyFileAsync(firstPhoto.path, outputPath)
      return
    }

    const doc = new PDFDocument({ 
      autoFirstPage: false,
      size: 'A4',  // Always A4
      font: 'Helvetica'
    })
    
    const writeStream = createWriteStream(outputPath)
    doc.pipe(writeStream)

    // Process all photos in the item
    for (let item of data['@graph']) {
      if (!item.photo) continue

      for (let photo of item.photo) {
        if (photo.protocol !== 'file') continue

        // Always add a portrait page
        doc.addPage({
          size: 'A4',
          layout: 'portrait'  // Always portrait
        })

        // Get original dimensions
        let width = photo.width
        let height = photo.height

        // Determine if dimensions need to be swapped based on total rotation
        let totalRotation = photo.angle || 0
        switch (photo.orientation) {
          case 3: totalRotation += 180; break;
          case 6: totalRotation += 90; break;
          case 8: totalRotation -= 90; break;
        }
        
        // Normalize rotation to 0-360
        totalRotation = ((totalRotation % 360) + 360) % 360
        
        // Swap dimensions if total rotation is 90 or 270 degrees
        if (totalRotation === 90 || totalRotation === 270) {
          [width, height] = [height, width]
        }

        // Calculate available space with different margins based on orientation
        const minMargin = 7.2    // Minimum margin (0.25 inches) for printer
        const isLandscape = width > height
        
        // Use different margins based on photo orientation
        const sideMargin = minMargin
        const topBottomMargin = isLandscape ? 50 : minMargin // Only use large margins for landscape

        // Calculate available space
        const availableWidth = doc.page.width - (2 * sideMargin)
        const availableHeight = doc.page.height - (2 * topBottomMargin)

        // Calculate scale to fit within available space
        const scale = Math.min(
          availableWidth / width,
          availableHeight / height
        )

        // Calculate final dimensions
        const finalWidth = photo.width * scale  // Use original dimensions for drawing
        const finalHeight = photo.height * scale

        // Center on page
        const x = (doc.page.width - finalWidth) / 2
        const y = (doc.page.height - finalHeight) / 2

        // Apply transformations
        doc.save()
        
        // Move to center of image position
        doc.translate(x + (finalWidth / 2), y + (finalHeight / 2))

        // Apply rotations
        if (photo.angle !== 0) {
          doc.rotate(photo.angle)
        }

        switch (photo.orientation) {
          case 3:
            doc.rotate(180)
            break
          case 6:
            doc.rotate(90)
            break
          case 8:
            doc.rotate(-90)
            break
        }

        // Draw image centered at current position
        doc.image(photo.path, -finalWidth/2, -finalHeight/2, {
          width: finalWidth,
          height: finalHeight
        })

        doc.restore()
      }
    }

    doc.end()
    
    return new Promise((resolve, reject) => {
      writeStream.on('finish', resolve)
      writeStream.on('error', reject)
    })
  }

  async export(data) {
    let { pdfFile, filters } = this.options

    // Get the first item's title to use as default filename
    const defaultTitle = data['@graph'][0]?.title || 'export'
    const defaultPdfFile = `${defaultTitle}.pdf`

    // Check if we're dealing with a PDF file
    const firstPhoto = data['@graph'][0]?.photo?.[0]
    const isPDF = firstPhoto?.mimetype === 'application/pdf'

    // Remove the multiple PDF check since multiple photos can come from the same PDF
    
    if (!pdfFile || this.options.prompt) {
      pdfFile = await this.dialog({ 
        defaultPath: defaultPdfFile,
        filters 
      })
    }

    if (!pdfFile) return

    // Ensure file has .pdf extension
    if (extname(pdfFile) !== '.pdf') {
      throw new Error(`not a pdf file: ${pdfFile}`)
    }

    // Generate the PDF or copy the original PDF
    await this.generatePDF(data, pdfFile)

    // Open the PDF file directly instead of showing in folder
    await shell.openPath(pdfFile)
  }
}

PDFOriginalPlugin.defaults = {
  filters: [
    {
      name: 'PDF Files',
      extensions: ['pdf']
    }
  ],
  prompt: false
}

module.exports = PDFOriginalPlugin






